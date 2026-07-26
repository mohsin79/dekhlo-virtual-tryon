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
- **Event key:** from `INNGEST_EVENT_KEY` (undefined in pure local dev with `INNGEST_DEV=1`)

## Serve route

- **Path:** `app/api/inngest/route.ts`
- **Runtime:** Node.js
- **Exports:** `GET`, `POST`, `PUT` via `inngest/next` `serve()`
- **maxDuration:** `300` seconds (aligns with long-running generation steps on Vercel-style hosts)
- **Registered functions:** `process-try-on-generation`, `cleanup-expired-try-on-artifacts`
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

Helpers: `lib/try-on/sessions/session-polling.ts`.

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

1. Start Supabase and the app with `INNGEST_DEV=1` in `.env.local`.
2. Run the [Inngest Dev Server](https://www.inngest.com/docs/local-development) pointed at:

   `http://localhost:3000/api/inngest`

3. In the Dev UI confirm:
   - App `dekhlo` is synced
   - `process-try-on-generation` and `cleanup-expired-try-on-artifacts` are registered
   - One generation event → one run; steps visible; duplicate event id does not double-consume credits

Do not paste production Inngest keys into local env files committed to git.

## Production setup (manual)

1. Create an Inngest account and environment for production.
2. Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` in the hosting provider (e.g. Vercel) — server env only.
3. Sync the app URL so Inngest can reach `https://<your-domain>/api/inngest`.
4. If using Vercel Deployment Protection, allow Inngest ingress or use `INNGEST_SERVE_ORIGIN` as documented by Inngest.
5. Optionally configure `INNGEST_SIGNING_KEY_FALLBACK` during key rotation.

Production Inngest Cloud was **not** connected as part of Phase 7 implementation in-repo; operators must complete the steps above.

## Testing

```bash
npm run test:unit          # includes tests/unit/phase7-inngest.test.ts
npx supabase db reset --local
npx supabase test db --local
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

OpenAI is not called in automated tests. Production Inngest functions are validated via the local Dev Server (see above).

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
