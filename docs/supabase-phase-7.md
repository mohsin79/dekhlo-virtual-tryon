# Supabase Phase 7 — Inngest Background Generation and Retention Cleanup

Phase 7 moves merchant try-on generation off the synchronous HTTP request path into Inngest, adds session status polling in the public UI, and schedules hourly cleanup of expired private artifacts with stale reserved-credit recovery. Platform admin, audit logs, billing, Sentry, and PostHog remain deferred (Phase 8+).

**No credentials are stored in this document.**

## Installed packages

| Package | Version | Role |
|---------|---------|------|
| `inngest` | 4.13.0 | Production SDK (client, serve route, functions) |
| `@inngest/test` | 1.0.0 | Dev-only function test engine |

Record exact versions after install:

```bash
npm ls inngest @inngest/test --depth=0
```

## Environment variables (server-only)

| Variable | Required | Notes |
|----------|----------|-------|
| `INNGEST_EVENT_KEY` | Production event send | Never use `NEXT_PUBLIC_` |
| `INNGEST_SIGNING_KEY` | Production serve | Used by Inngest Cloud to verify `/api/inngest` |
| `INNGEST_SIGNING_KEY_FALLBACK` | Optional | Key rotation |
| `INNGEST_DEV` | Local | Set to `1` for Dev Server; skips event-key requirement for dispatch |
| `INNGEST_SERVE_ORIGIN` | Optional | Custom production origin when not inferred automatically |

Rules:

- Local development: `INNGEST_DEV=1` in `.env.local`
- Production dispatch calls `assertInngestEventSendingConfigured()` and fails clearly when `INNGEST_EVENT_KEY` is missing (unless dev mode)
- Health endpoints do **not** expose Inngest configuration or secrets

See `.env.example` for placeholders.

## Event contract

| Name | Deterministic event `id` | Payload |
|------|--------------------------|---------|
| `dekhlo/try-on.generation.requested` | `try-on-generation:{sessionId}` | `{ sessionId, brandId }` |

Excluded from events (by design): session tokens, token hashes, Storage paths, signed URLs, image bytes, credit amounts, emails, Supabase keys.

Implementation: `lib/inngest/events.ts`, `lib/try-on/sessions/dispatch-generation.ts`.

## Inngest client

- **App ID:** `dekhlo`
- **Module:** `lib/inngest/client.ts`
- **Dev mode:** `isDev: isInngestDevMode()` so `INNGEST_DEV=1` selects Inngest **dev** mode (no signing key required for serve introspection)
- **Event key:** from `INNGEST_EVENT_KEY` (optional when `INNGEST_DEV=1`)

## Serve route

- **Path:** `app/api/inngest/route.ts`
- **Runtime:** Node.js
- **Exports:** `GET`, `POST`, `PUT` via `inngest/next` `serve()`
- **maxDuration:** `300` seconds (aligns with long-running generation steps on Vercel-style hosts)
- **Registered functions:** see `lib/inngest/registry.ts` (`process-try-on-generation`, `cleanup-expired-try-on-artifacts`)
- **proxy.ts:** does not protect `/api/inngest`; only `/dashboard` and `/onboarding` redirect unauthenticated users

## Dispatch (canonical merchant path)

After upload validation and successful `queue_try_on_session`:

1. Session status is `queued` and one credit is reserved (Phase 6 RPC).
2. `dispatchTryOnGeneration` sends the Inngest event with id `try-on-generation:{sessionId}`.
3. `POST .../validate-upload` returns **HTTP 202** with queued session metadata.
4. The browser polls `GET /api/try-on/sessions/[sessionId]` (session cookie required).

Recovery: `POST .../generate` re-dispatches the same deterministic event for `queued`/`processing` sessions (202). It does **not** reserve another credit or create a session.

If the first event send fails, the session stays `queued` and recovery via `POST .../generate` is safe.

Demo generation (`/api/try-on`) remains synchronous and separate from merchant sessions.

## Generation function

| Property | Value |
|----------|-------|
| Function ID | `process-try-on-generation` |
| Trigger | `dekhlo/try-on.generation.requested` |
| Retries | **3** (conservative; transient OpenAI/Storage/network errors) |
| Concurrency | **1** per `event.data.sessionId`; **8** global (Inngest v4 allows two concurrency rules) |

### Durable steps

1. `load-and-validate-session` — reload row; skip completed/terminal/deleted/expired
2. `claim-processing-state` — atomic `queued` → `processing`; set `provider_job_id` to Inngest run ID
3. `download-person-photo`
4. `obtain-product-image`
5. `generate-try-on-result` — existing `lib/try-on/generate.ts` (prompt/model unchanged)
6. `record-provider-request-id` — when OpenAI returns `response.id`
7. `upload-result` — deterministic `{brand_id}/{session_id}/result.png`
8. `persist-result-path`
9. `consume-reserved-credit` — `consume_reserved_brand_credits` only
10. `finalize-session`

Worker helpers: `lib/try-on/worker/generation-steps.ts`.

### Idempotency

- Database session status and Phase 6 credit RPC idempotency keys remain authoritative.
- The worker never calls `queue_try_on_session` (no new reserves).
- Completed sessions short-circuit without re-generation or re-consume.
- Duplicate events share the same Inngest event id; concurrent runs for one session are limited to 1.
- Result path is scoped per session; customer upload paths are never overwritten by upsert semantics.

### Failure handling

- Permanent validation errors → `NonRetriableError` after optional compensation for known worker faults.
- Transient errors → Inngest retries; credits are **not** released until retries exhaust.
- `onFailure` handler → durable step `release-after-final-failure` reloads session id from failure payload, removes partial results when applicable, `release_reserved_brand_credits`, sanitized error on session.
- Raw provider errors are not stored on the session row.

## Provider tracking

| Field | Source |
|-------|--------|
| `provider_job_id` | Inngest function run ID at claim-processing |
| `provider_request_id` | OpenAI Responses API `response.id` when present |

Not exposed on anonymous/public session responses. Not used for authorization.

## Session polling (UI)

`components/ProductTryOn.tsx`:

- After 202 from validate-upload, phase → `polling`
- Polls `GET /api/try-on/sessions/[sessionId]` with cookie auth only
- Continues while status is `queued` or `processing`
- Stops on `completed`, `failed`, `cancelled`, or unmount
- Backoff: 1s initial, +500ms per attempt, max ~5s
- Handles 503 without creating a new session
- Displays signed `resultUrl` from status endpoint (refresh via authorized GET)
- **Choose another photo** (commit `9f60f1a`): resets uploader and requires a new file + explicit **Generate try-on**; blocks same-photo/same-product retries via client fingerprint (no extra session or credit until generate)

Helpers: `lib/try-on/sessions/session-polling.ts`, `lib/try-on/sessions/product-try-on-flow.ts`, `lib/try-on/sessions/photo-fingerprint.ts`.

## Retention cleanup cron

| Property | Value |
|----------|-------|
| Function ID | `cleanup-expired-try-on-artifacts` |
| Schedule | `0 * * * *` (hourly UTC) |
| Batch size | **50** sessions per run |

Selection: `expires_at <= now()` and `deleted_at is null`.

Per session (admin client):

| Status | Credits | Artifacts | `deleted_at` |
|--------|---------|-----------|--------------|
| `pending_upload` | none | remove person upload if present | set after cleanup |
| `queued` / `processing` | `release_reserved_brand_credits` | remove person/result | set after cleanup + safe error |
| `failed` / `cancelled` | release if reservation may remain (idempotent RPC) | remove person/result | set after cleanup |
| `completed` | never release consumed | remove person/result per retention | set after cleanup |

Path guards: only `customer-uploads` person paths and `try-on-results` result paths matching `{brand_id}/{session_id}/…` regex helpers. **Never** delete `product-images`. Missing Storage objects are ignored. Rows are soft-deleted only (`deleted_at`); credit ledger rows are untouched.

Retention timing remains whatever `expires_at` was set to at session creation (24h default; 30d with consent after completion). Cleanup does not extend retention.

Implementation: `lib/try-on/cleanup/expired-session-cleanup.ts`, `listExpiredSessionsForCleanup` in session service.

## Local Dev Server

1. Ensure `.env.local` includes `INNGEST_DEV=1` (mirrors `.env.example`). Without it, the Inngest SDK stays in **cloud** mode and `GET /api/inngest` returns **500** because no signing key is configured.
2. Terminal 1 — start Next.js on port 3000:

   ```powershell
   npm run dev:inngest
   ```

   (`dev:inngest` sets `INNGEST_DEV=1` via `cross-env` and binds `-p 3000`.)

3. Confirm serve introspection **before** starting the Dev Server:

   ```powershell
   Invoke-WebRequest http://localhost:3000/api/inngest -UseBasicParsing
   ```

   Expected: **HTTP 200** JSON with `"mode":"dev"`, `"has_event_key":false`, `"has_signing_key":false`, and a `function_count` field (Inngest v4 may report one extra internal SDK entry in addition to the two application functions).

4. Terminal 2 — Inngest Dev Server:

   ```powershell
   npx --ignore-scripts=false inngest-cli@latest dev --no-discovery -u http://localhost:3000/api/inngest
   ```

5. Dev UI: `http://localhost:8288` — confirm app **`dekhlo`**, functions **`process-try-on-generation`** (event `dekhlo/try-on.generation.requested`) and **`cleanup-expired-try-on-artifacts`** (cron `0 * * * *`). Successful sync shows repeated **`PUT /api/inngest` 200** in the Next.js log.

Optional event smoke test (no OpenAI; missing session id skips safely):

```powershell
node scripts/phase7-send-generation-event.mjs <sessionId> <brandId>
```

Do not paste production Inngest keys into local env files committed to git.

## Runtime verification (final)

Phase 7 commits on branch `B2B-saas-implementation`:

| Commit | Summary |
|--------|---------|
| `38febb17…` | Async Inngest generation, polling, cleanup cron |
| `d1eff793…` | Inngest dev serve fix (`INNGEST_DEV=1`, `GET /api/inngest` 200) |
| `9f60f1a9…` | Choose another photo UX; no accidental re-generation |

### Serve route fix (prior `GET /api/inngest` 500)

The Next.js log showed: `In cloud mode but no signing key found. For local dev, set the INNGEST_DEV=1 env var.`

**Root cause:** `INNGEST_DEV` was not loaded while the dev server was running. The SDK stayed in **cloud** mode and `checkModeConfiguration()` returned 500.

**Fix (in `d1eff793`):** `INNGEST_DEV=1` in `.env.local`, `isDev: isInngestDevMode()` on the client, `npm run dev:inngest`.

Healthy local introspection (safe fields): `"mode":"dev"`, `"has_event_key":false`, `"has_signing_key":false`. Application registers **two** functions in `lib/inngest/registry.ts`; SDK `function_count` may include one internal v4 entry.

### Manual runtime verification — **passed**

Verified locally with `npm run dev:inngest`, Inngest Dev Server (`http://localhost:3000/api/inngest`), Dev UI on port 8288, and merchant `/try/[brandSlug]/[productSlug]` against the configured Supabase project. No credentials, tokens, signed URLs, or customer image data are recorded here.

| Area | Result |
|------|--------|
| Real asynchronous generation through Inngest | **Passed** |
| Browser polling to completed result | **Passed** |
| `provider_job_id` populated (Inngest run ID) | **Passed** |
| One reserve and one consume transaction per successful try-on | **Passed** |
| Deterministic event ID deduplication (`try-on-generation:{sessionId}`) | **Passed** |
| Completed-session worker skip (duplicate/replay) | **Passed** |
| Duplicate events do not consume credits twice | **Passed** |
| Transient failure retries successfully (fail-once local hook test; hook removed before close) | **Passed** |
| No release transaction during transient retries | **Passed** |
| Permanent failure exhausts configured retries (always-fail local hook test; hook removed before close) | **Passed** |
| Permanent failure creates exactly one release transaction | **Passed** |
| Failed session returns reserved credits to available balance | **Passed** |
| Expired `pending_upload` session cleanup | **Passed** |
| Expired `failed` session cleanup | **Passed** |
| Failed-session release idempotent during cleanup | **Passed** |
| Expired `completed` session cleanup | **Passed** |
| Completed session: consumed credits unchanged after cleanup | **Passed** |
| Private customer uploads and result images removed | **Passed** |
| `product-images` untouched | **Passed** |
| `deleted_at` soft deletion after cleanup | **Passed** |
| Hourly cron `0 * * * *` triggers automatically | **Passed** |
| Cleanup batch size **50** and path validation unchanged | **Passed** |

Temporary local test hooks used only for retry/final-failure manual runs were **not committed** and were removed before Phase 7 close.

### npm audit (`npm audit --omit=dev`)

**Initial run (2026-07-26, Phase 7 close):**

| Field | Value |
|-------|--------|
| Request completed | **Yes** |
| Exit code | **1** (vulnerabilities reported) |
| Severity counts | **9 high**, 0 moderate, 0 low, 0 critical |
| Production dependency packages named in report | `brace-expansion`, `minimatch`, `glob`, `rimraf`, `gaxios`, `gcp-metadata`, `postcss`, `next`, `sharp` |

**Inngest-related chain:** `inngest@4.13.0` → OpenTelemetry GCP detector → `gcp-metadata` → `gaxios` → vulnerable `glob`/`minimatch`/`brace-expansion`/`rimraf` versions. These advisories are **introduced or reachable via the Inngest 4.x dependency tree** (not present before Inngest was added in Phase 7).

**Next.js transitive chain:** `next@16.2.11` → nested `postcss@8.4.31`; optional `sharp@0.34.5`. `npm audit fix --force` would install **`next@9.3.3`** — **not applied**.

**Post–Phase 7 production remediation (2026-07-27):** See `docs/dependency-security-review-2026-07.md`. After scoped overrides and lockfile dedupe (`postcss@8.5.21`, `sharp@0.35.0`, `gaxios` → `rimraf@6`, `minimatch@10` → `brace-expansion@5.0.8`), **`npm audit --omit=dev` exit code 0** with **0 high** production findings. No force-fix or framework downgrade. Dev-only ESLint/minimatch@3 advisories may still appear in a full `npm audit` (includes devDependencies).

Do **not** run blind `npm audit fix` or `npm audit fix --force` without the review in `docs/dependency-security-review-2026-07.md`.

### Production Inngest Cloud

Still **not** connected in-repo. Configure keys and app sync per §Production setup below.

## Production setup (manual)

1. Create an Inngest account and environment for production.
2. Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` in the hosting provider (e.g. Vercel) — server env only.
3. Sync the app URL so Inngest can reach `https://<your-domain>/api/inngest`.
4. If using Vercel Deployment Protection, allow Inngest ingress or use `INNGEST_SERVE_ORIGIN` as documented by Inngest.
5. Optionally configure `INNGEST_SIGNING_KEY_FALLBACK` during key rotation.

Production Inngest Cloud was **not** connected as part of Phase 7 implementation in-repo; operators must complete the steps above.

## Testing (automated close — 2026-07-26)

```bash
npm run test:unit          # 80 tests (includes phase7-inngest, product-try-on-another-photo)
npx supabase db reset --local
npx supabase test db --local   # 286 pgTAP tests, 15 files
npx tsc --noEmit
npm run lint
npm run build
npm audit --omit=dev
```

Phase 7 unit tests cover:

- Event id and payload shape
- Polling backoff and terminal statuses
- Worker session evaluation skips (`lib/try-on/worker/session-evaluation.ts`)
- Cleanup path guards (`lib/try-on/cleanup/path-guards.ts`)
- `@inngest/test` executions using production-shaped test doubles (same step IDs and retry/concurrency options as the live functions)
- Inngest env configuration rules

- `@inngest/test` executions using production-shaped test doubles (same step IDs and retry/concurrency options as the live functions)
- Inngest env configuration rules
- Choose-another-photo flow and duplicate-photo fingerprint guards

OpenAI is not called in automated tests. Full merchant async behavior is validated via manual runtime verification (table above).

## Phase 7 status

**Closed** after documentation of passed manual verification and automated checks above. Phase 8 (platform admin, audit, billing, Sentry, PostHog) is **not** started.

## Rollback strategy

1. Revert the Phase 7 commit and redeploy without Inngest env vars.
2. Queued sessions may stall without a worker; operators can run manual credit release via existing service_role RPCs if needed.
3. No Phase 7 migration was required for core behavior; if a future migration was added, roll forward fixes are preferred over editing applied migrations.

## Deferred (Phase 8+)

- `platform_role`, `audit_logs`, admin grant/revoke
- Leads, Sentry, PostHog, Resend, Stripe billing
- WebSockets / Inngest Realtime for try-on status
- Hard deletion of historical session rows

## Phase 6 reference

Credit lifecycle, session tokens, and Storage layout remain as documented in `docs/supabase-phase-6.md`. Phase 6 migrations are unchanged.
