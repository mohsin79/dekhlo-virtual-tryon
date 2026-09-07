# Phase 8C — Observability and privacy-safe error handling

**Status:** Phase 8C.1 **runtime verified and closed** (server-side Sentry only)  
**Branch:** `B2B-saas-implementation`  
**Implementation commits:** `7a4b452` (feat), `2e1767e` (privacy hardening)  
**Scope:** Server-side error observability, deep scrubbing, and client-safe error sanitization. PostHog, browser Sentry, and analytics consent are deferred to Phase 8C.2+.

---

## 1. Phase 8C.1 scope

Phase 8C.1 adds **server-only Sentry** for unexpected infrastructure and application failures. It does **not** add:

- `NEXT_PUBLIC_SENTRY_DSN`
- `instrumentation-client.ts`
- Browser Sentry provider or initialization
- Session replay, user feedback widgets, or browser performance tracing
- PostHog or analytics consent (Phase 8C.2)
- Database migrations
- Changes to Inngest architecture, credits, leads schema, storage retention, or platform authorization semantics

### Why client Sentry is deferred

Merchant and shopper flows handle sensitive images, session tokens, and lead PII. Browser-side error reporting requires a separate privacy review (consent, scrubbing, sampling, and replay exclusions) before any client SDK is enabled. Phase 8C.1 focuses on failures that only occur on trusted server/infrastructure surfaces.

---

## 2. Installed dependency

| Package | Version | Notes |
|---------|---------|-------|
| `@sentry/nextjs` | **10.71.0** | Stable; supports Next.js 16.2.11, React 19, Node ≥ 20.9 |

Installed with the repository’s established resolver: `npm ci --legacy-peer-deps` (OpenAI/Zod peer conflict).

Production audit after install: **0 vulnerabilities**.

---

## 3. Server initialization architecture

| File | Role |
|------|------|
| `instrumentation.ts` | Loads server Sentry config when `NEXT_RUNTIME === "nodejs"` |
| `sentry.server.config.ts` | `Sentry.init()` with `sendDefaultPii: false`, `tracesSampleRate: 0`, `beforeSend` scrubbing |
| `lib/observability/sentry.ts` | Central wrapper: `captureUnexpectedError`, `captureOperationalMessage` |
| `lib/observability/sentry-scrub.ts` | Deep scrubbing, URL sanitization, allowlisted context |
| `lib/observability/capture-policy.ts` | Expected vs unexpected error classification |
| `next.config.mjs` | Minimal `withSentryConfig()` for optional source-map upload |

**Edge config:** Not added. The only Edge runtime surface is `app/opengraph-image.tsx`, which does not require server error monitoring in 8C.1.

When `SENTRY_DSN` is absent, Sentry initialization is skipped and wrapper calls are no-ops. Application startup and local builds succeed without observability credentials.

---

## 4. Environment variables

| Variable | Required | Scope |
|----------|----------|-------|
| `SENTRY_DSN` | Optional (required for production observability) | Server runtime only |
| `SENTRY_ENVIRONMENT` | Optional | Defaults to `NODE_ENV` |
| `SENTRY_RELEASE` | Optional | Build/deployment supplied |
| `SENTRY_AUTH_TOKEN` | CI/deployment only | Source-map upload; never read by application runtime code |
| `SENTRY_ORG` | CI/deployment only | Source-map upload |
| `SENTRY_PROJECT` | CI/deployment only | Source-map upload |

Production observability is **not considered enabled** until `SENTRY_DSN` is configured in the deployment environment.

Placeholders are documented in `.env.example` (comments only; no values committed).

---

## 5. Central wrapper and safe tags

Application code must not call `Sentry.captureException` directly with arbitrary context. Use `lib/observability/sentry.ts`:

- `captureUnexpectedError(error, context)` — unexpected failures
- `captureOperationalMessage(messageCode, context)` — configuration/operational warnings

**Allowlisted context tags:**

- `routeCategory`
- `operation`
- `errorCategory`
- `sessionStatusClass`
- `inngestFunctionId`

**Never included:** raw request/response objects, customer strings, UUIDs, storage paths, signed URLs, lead PII, provider payloads, admin reason text, or environment values.

---

## 6. Scrubbing rules

`beforeSend` and `deepScrub` recursively redact keys matching sensitive concepts, including:

- Authorization, Cookie, Set-Cookie, tokens, secrets, API keys, passwords
- Signed URLs and storage paths (`personStoragePath`, `resultStoragePath`, `storagePath`)
- Lead PII (`email`, `phone`, `fullName`)
- Request bodies, form/multipart contents, OpenAI request/response payloads
- Image data URLs and uploaded image previews

URL sanitization strips sensitive query parameters. Structure size is capped (`maxDepth`, `maxKeys`, `maxStringLength`, `maxArrayLength`) to prevent oversized Sentry events.

User email and IP are removed from events. Request cookies, Authorization headers, and request body/data are stripped.

---

## 7. Capture / exclusion matrix

| Outcome | HTTP status | Sentry capture |
|---------|-------------|----------------|
| Validation / bad input | 400 | No |
| Authentication failure | 401 | No |
| Authorization failure | 403 | No |
| Not found / enumeration-resistant | 404 | No |
| Conflict (lead, idempotency) | 409 | No |
| Expired session | 410 | No |
| Wrong content type | 415 | No |
| Business rule / consent | 422 | No |
| Rate limiting | 429 | No |
| Unexpected server/infrastructure failure | 500+ | Yes |
| Final provider exhaustion (after retries) | 502 (client sanitized) | Yes (server-side, once) |
| Transient Inngest retry | — | No (suppressed per-attempt; final `onFailure` only) |
| Expected worker permanent errors (`TryOnWorkerPermanentError`, `NonRetriableError`) | — | No |

Mapped lead/platform RPC errors retain existing sanitized client responses. Only **unmapped 500-class** RPC/query failures are captured.

---

## 8. Demo error sanitization

`lib/try-on/generate.ts` and `lib/try-on/demo-handler.ts` no longer return:

- Raw OpenAI `error.message`
- Provider response text or stack traces
- `OPENAI_API_KEY` setup hints

Client responses use generic messages:

- `"Try-on generation failed. Please try again."`
- `"The try-on service is temporarily unavailable."`

Real errors are reported through the centralized wrapper on the demo path. The merchant Inngest worker passes `reportToObservability: false` to avoid duplicate capture on transient retries; final failure is captured in `onFailure`.

---

## 9. Inngest final-failure policy

| Function | Capture point | Safe tags only |
|----------|---------------|----------------|
| `process-try-on-generation` | `onFailure` after retries exhausted | `routeCategory`, `operation`, `errorCategory`, `inngestFunctionId` |
| `cleanup-expired-try-on-artifacts` | `onFailure` | Same allowlist |

No session IDs, brand/product IDs, storage paths, provider payloads, prompts, or image content are sent to Sentry.

---

## 10. Source-map deployment model

- Source maps are uploaded through the Sentry Next.js integration **only when** `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are present at build time.
- `sourcemaps.disable: true` when the auth token is absent — local and CI builds without upload credentials succeed.
- `SENTRY_AUTH_TOKEN` is referenced only in `next.config.mjs` (build-time); it is not an application-runtime requirement.
- No browser tunnel route in 8C.1.
- Source maps are not committed to the repository.

---

## 11. Production configuration checklist

1. Create a Sentry project (server-only DSN).
2. Set `SENTRY_DSN` in the deployment environment (server-only secret).
3. Optionally set `SENTRY_ENVIRONMENT` and `SENTRY_RELEASE`.
4. For source maps: configure `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` in CI/deployment build environment.
5. Confirm no `NEXT_PUBLIC_SENTRY_*` variables are present.
6. Verify production builds succeed and unexpected 500-class failures appear in Sentry with scrubbed payloads.

---

## 12. Privacy constraints

- `sendDefaultPii: false`
- No session replay or profiling
- No user identity enrichment
- No customer identifiers, image content, signed URLs, or lead PII in events
- No DSN or auth tokens in documentation or committed env files

---

## 13. Local verification

```bash
npx supabase db reset --local
npx supabase test db --local
npm run test:unit
npx tsc --noEmit
npm run lint
npm run build
npm audit --omit=dev --registry=https://registry.npmjs.org/
```

Build without any Sentry credentials must succeed. With `SENTRY_DSN` unset, wrapper calls are safe no-ops.

---

## 14. Phase 8C.1 runtime verification (closed)

Verified on branch `B2B-saas-implementation` after commits `7a4b452` and `2e1767e`. Phase 8C.1 is **runtime verified and closed**.

### Sentry project / runtime

| Check | Result |
|-------|--------|
| Sentry project configured | Pass |
| `SENTRY_DSN` configured locally (value not committed) | Pass |
| `SENTRY_ENVIRONMENT=development` for verification | Pass |
| `SENTRY_RELEASE=phase8c1-local` for verification | Pass |
| Server-side Sentry initialization | Pass |
| `captureUnexpectedError` delivered synthetic server event | Pass |
| Event appeared in configured Sentry project | Pass |
| `routeCategory=diagnostic` | Pass |
| `operation=sentry_smoke` | Pass |
| `errorCategory=verification` | Pass |
| `environment=development` | Pass |
| `release=phase8c1-local` | Pass |

No account IDs, project IDs, DSN values, auth tokens, or organization secrets are recorded in this document.

### SDK privacy hardening

Final received event confirmed **absence** of:

- `server_name` / machine hostname
- browser context
- client OS context
- device context
- locale / culture context
- timezone context
- User-Agent
- request headers
- Cookie
- Authorization
- Set-Cookie
- X-Forwarded-For
- Referer
- request body
- raw query string
- Supabase auth token
- try-on session token
- API key
- signed URL
- storage path
- lead email
- lead phone
- lead full name
- customer image data

**Safe retained diagnostics:**

- `environment`
- `release`
- `routeCategory`
- `operation`
- `errorCategory`
- generic Node runtime name/version
- sanitized route/method
- sanitized breadcrumbs

### Sentry-side privacy settings

Sentry project privacy configuration was also hardened:

- IP storage prevention / IP scrubbing enabled
- Advanced data scrubbing configured to remove user geography
- Subsequent new event verified that User → Geography was no longer present

### Browser architecture verification

| Check | Result |
|-------|--------|
| No `instrumentation-client.ts` | Pass |
| No `NEXT_PUBLIC_SENTRY_DSN` | Pass |
| No browser Sentry initialization | Pass |
| Browser Network inspection: no Sentry ingestion requests | Pass |
| No Session Replay | Pass |
| No profiling | Pass |
| `tracesSampleRate = 0` | Pass |
| No user identify/enrichment | Pass |

### Application behavior

| Check | Result |
|-------|--------|
| Demo provider/OpenAI errors remain sanitized for clients | Pass |
| Raw provider error messages do not reach clients | Pass |
| `OPENAI_API_KEY` hints do not reach clients | Pass |
| Expected 400/401/403/404/409/410/415/422/429 outcomes remain excluded | Pass |
| Mapped lead/platform RPC errors remain excluded | Pass |
| Transient Inngest retries are not individually reported | Pass |
| Terminal Inngest failures use server-side observability | Pass |
| Cleanup terminal failures are capturable | Pass |
| Unexpected server/infrastructure failures remain capturable | Pass |

### Temporary verification route

- `app/api/dev/sentry-smoke/route.ts` was used **only** for local testing
- It was **never committed**
- It was **removed** after verification

### Lint baseline

- Verified baseline: **4 warnings, 0 errors**
- Phase 8C.1 introduced **no persistent new lint warning**

### Final regression (Phase 8C.1 closure)

| Check | Result |
|-------|--------|
| pgTAP | **360 pass** (20 files) |
| Unit tests | **192 pass** |
| TypeScript (`tsc --noEmit`) | Pass |
| Lint | Pass — **4 warnings, 0 errors** |
| Build | Pass — Next.js **16.2.11** |
| Production npm audit | **0 vulnerabilities** |

Commands:

```bash
npx supabase db reset --local
npx supabase test db --local
npm run test:unit
npx tsc --noEmit
npm run lint
npm run build
npm audit --omit=dev --registry=https://registry.npmjs.org/
```

---

## 15. Phase 8C.2 — privacy-safe PostHog analytics (implemented, not runtime verified)

**Status:** Implementation complete; **runtime verification not closed** in this phase.  
**Package:** `posthog-js@1.421.2` (client-only; no `@posthog/next`, no server-side PostHog)

### Architecture

| Layer | Role |
|-------|------|
| `components/analytics/analytics-shell.tsx` | Root wrapper: provider, consent banner, pageview tracker |
| `components/analytics/posthog-provider.tsx` | Consent-gated PostHog initialization (Strict Mode safe singleton) |
| `components/analytics/analytics-consent-banner.tsx` | Non-blocking consent UI |
| `components/analytics/pageview-tracker.tsx` | Explicit `$pageview` after consent (sanitized route groups only) |
| `lib/analytics/consent.ts` | Cookie schema + parsing |
| `lib/analytics/track.ts` | Strict typed tracking wrapper |
| `lib/analytics/events.ts` | Event/property allowlists |
| `lib/analytics/posthog-client.ts` | PostHog init/shutdown/capture (only direct `posthog.capture` site) |

Sentry (Phase 8C.1) remains isolated: no PostHog identifiers sent to Sentry, no Sentry IDs sent to PostHog, no analytics consent attached to Sentry events.

### Environment variables

| Variable | Scope |
|----------|-------|
| `NEXT_PUBLIC_POSTHOG_KEY` | Public ingestion key (optional) |
| `NEXT_PUBLIC_POSTHOG_HOST` | Public ingestion host (optional) |

If either is absent, analytics safely no-ops. Local development does not require PostHog configuration.

### Consent model

Cookie: `dekhlo-analytics-consent`

```json
{ "v": 1, "state": "accepted" | "declined", "at": "<ISO8601>" }
```

States: `undecided`, `accepted`, `declined`

- `Path=/`, `SameSite=Lax`, `Secure` in production, `Max-Age=31536000`
- Browser-readable; contains **no user identifier**
- Version mismatch => `undecided` (re-prompt)
- `Analytics preferences` shows the saved choice and switches between `accepted`/`declined`; it does **not** reopen the main consent prompt

### Consent resolution and hydration

The consent cookie cannot be read during a server or prerendered render, and `/`, `/demo`, and
`/auth/sign-up` are prerendered as static HTML. Consent therefore has a fourth internal
**status**, `resolving`, which is distinct from the three consent **states** and is never treated
as `undecided`.

- `lib/analytics/consent-store.ts` exposes the cookie as an external store; `PostHogProvider`
  reads it with `useSyncExternalStore`
- Server/hydration snapshot is `resolving`, so prerendered HTML never contains the banner
- The stored preference is adopted immediately after hydration, so a valid `accepted`/`declined`
  cookie survives refresh with no consent-banner flash
- Main banner renders only when the status is exactly `undecided`
- PostHog initialization is skipped entirely while the status is `resolving`

**Legal note:** Final production consent copy and retention require legal/privacy review. This implementation does not claim GDPR/PECA/CCPA compliance.

### PostHog initialization (accepted consent only)

All keys below were verified against the installed posthog-js 1.421.2 type surface
(`@posthog/types/dist/posthog-config.d.ts`) before being applied.

```typescript
// Capture surfaces
autocapture: false
capture_pageview: false
capture_pageleave: false
capture_dead_clicks: false
capture_exceptions: false
capture_heatmaps: false
capture_performance: false
disable_session_recording: true
disable_surveys: true
disable_scroll_properties: true
disableDeviceModel: true

// Feature flags (unused in V1)
advanced_disable_feature_flags: true
advanced_disable_feature_flags_on_first_load: true
advanced_disable_toolbar_metrics: true

// No attribution
save_referrer: false
save_campaign_params: false

// Identity and persistence
person_profiles: "never"
persistence: "localStorage"

before_send: applyPostHogEventFirewall
```

No session replay, heatmaps, surveys, toolbar, identify/alias, or server-side PostHog.

`person_profiles: "never"` is a stable 1.421.2 setting and is preferred over the default
`identified_only` because Dekhlo never calls `identify()`, `alias()`, or `setPersonProperties()`.
Every event is sent with `$process_person_profile: false`.

`persistence: "localStorage"` keeps the anonymous distinct/device ID out of a cookie, so PostHog
adds no analytics identity cookie alongside our own first-party consent cookie.

### Outbound event firewall (`lib/analytics/posthog-firewall.ts`)

posthog-js runs `before_send` on the fully-built event immediately before the network request, and
a `null` return aborts the send. This is defense in depth for **SDK-generated** events; the typed
application wrapper in `lib/analytics/track.ts` remains the only sanctioned way for product code
to emit events.

- **Event allowlist:** `$pageview` plus the ten approved product events. Everything else is
  dropped, including `$autocapture`, `$dead_click`, `$exception`, `$snapshot`, `$pageleave`,
  `$identify`, `$create_alias`, `$feature_flag_called`, and any future automatic event.
- **Property sanitizer, stage 1:** explicit denylist of known SDK field names, plus a small set of
  `$`-scoped SDK namespaces (`$session_entry_`, `$prev_pageview_`, `$feature_flag`, `$sdk_debug_`,
  `$web_vitals`, `$surveys_`, `$posthog_sr_`). Because every prefix rule is `$`-scoped, it cannot
  match an approved application property.
- **Property sanitizer, stage 2:** a closed-world guard drops anything that is neither an approved
  application property nor a retained anonymous ingestion field, so unknown future SDK properties
  cannot leak by default.
- `$set`, `$set_once`, and `$unset` are cleared on every allowed event.

Stripped: raw user agent, browser/OS/device/timezone, screen and viewport geometry,
`$current_url`/`$host`/`$pathname`, referrer and referring domain, all `$session_entry_*`
attribution (including UTM values), page `title`, all feature flag metadata, and SDK
debug/`*_server_side` capability reporting.

Retained anonymous ingestion fields: `token`, `distinct_id`, `$device_id`, `$insert_id`, `$time`,
`$timestamp`, `$lib`, `$lib_version`, `$sdk_dist_channel`, `$session_id`, `$is_identified`,
`$process_person_profile`.

### GeoIP processing control

PostHog performs **server-side GeoIP enrichment from the request IP by default**, which can attach
IP address, city, country, continent, latitude, longitude, postal code, subdivision, and timezone
to the stored event even when the browser sends no location data.

Dekhlo therefore sends the processing-control property `$geoip_disable: true` on **every permitted
analytics event** (`$pageview` and all ten approved product events).

- Enforcement is central: `applyPostHogEventFirewall` stamps it during `before_send`, so no
  individual capture call has to remember it.
- It is **forced, not copied**. The sanitizer skips any incoming `$geoip_disable` value and sets
  `true` unconditionally, so an event arriving with `$geoip_disable: false` still leaves as `true`.
- Application code **cannot** override it. It is not in `APPROVED_ANALYTICS_PROPERTY_KEYS`, and
  `sanitizeAnalyticsEventInput` rejects any event input carrying an unapproved key, so `track()`
  callers cannot reach it.
- It is treated as a processing control, not a business analytics dimension.
- Dekhlo intentionally captures **no** location property. The known PostHog GeoIP field names and
  `$ip` are on the denylist, listed explicitly rather than via a `$geoip_` prefix rule so the
  `$geoip_disable` control is not caught by its own denylist.
- **No IP spoofing.** Dekhlo never sets `$ip` and never sends a placeholder address such as
  `0.0.0.0` or `127.0.0.1`. If PostHog Cloud still retains the transport IP after
  `$geoip_disable`, that is handled separately in the PostHog project Data Capture privacy
  settings, not from application code.

Runtime verification of the GeoIP behavior is **still pending**. This is a data-minimization
measure and is not a claim of legal compliance.

**On SDK identifiers.** `$session_id` is retained: it is a rotating, PostHog-generated **anonymous
analytics** identifier used for PostHog's session-level aggregation, and it is **not** a Dekhlo
try-on session ID, lead ID, or Supabase user ID. `$window_id` and `$pageview_id` are stripped:
in 1.421.2 `$window_id` only feeds session recording (disabled) and toolbar metrics (disabled),
and `$pageview_id` exists only to link `$pageview` to `$pageleave` (disabled). `$is_identified`
and `$process_person_profile` are retained deliberately so person processing stays off.

**Remote configuration.** With `advanced_disable_feature_flags: true`, posthog-js still issues one
`POST /flags/?v=2` on init, but sends `disable_flags: true` so no flag is evaluated and no flag
property is produced. That request only fetches project configuration (session recording/survey
config, supported compression, and the `$*_enabled_server_side` capability values), all of which
the firewall strips from outbound events. It can be removed entirely with the stable
`advanced_disable_flags: true`; `advanced_disable_decide` is deprecated in 1.421.2 and must not be
used. Dekhlo does not rely on project-side remote configuration for privacy — the client config
plus `before_send` are authoritative.

### Event allowlist (V1)

- `signup_started`
- `signup_completed`
- `brand_created`
- `product_created`
- `try_on_started`
- `try_on_completed`
- `try_on_failed`
- `lead_form_viewed`
- `lead_submitted`
- `dashboard_leads_viewed`

Deferred: `platform_credit_grant_completed`, `platform_credit_revoke_completed`

### Property allowlist

- `surface`
- `outcome`
- `error_category`
- `consent_version`
- `route_group`

Forbidden: email, phone, names, UUIDs, filenames, URLs, storage paths, tokens, search/query text, raw error messages, image data, lead/session/brand/product identifiers.

### Identity strategy (V1)

- **Public shoppers:** anonymous; no `identify()`, no `alias()`, no link to lead rows
- **Merchants:** anonymous usage events only; **merchant `identify()` deferred**

### No-capture surfaces

Applied to:

- `components/Uploader.tsx`
- Person-photo area in `components/ProductTryOn.tsx`
- Entire `components/leads/lead-capture-form.tsx`

Attributes: `data-ph-no-capture` and `ph-no-capture`

### Manual runtime verification (passed — phase not yet closed)

The checklist below was executed manually against a local build with PostHog configured. All
items passed. Phase 8C.2 is **not** marked fully closed: the production dependency audit still
requires remediation (see the pending Browserslist advisory), which is tracked separately.

**Consent state machine**

- `undecided` => consent banner shown and zero PostHog requests
- `declined` => zero PostHog requests
- `declined` cookie survives refresh
- a valid `declined` state does not reopen the main consent banner
- `Analytics preferences` shows the saved choice
- `accepted` => PostHog initializes
- `accepted` cookie survives refresh
- `accepted` -> `declined` => all future PostHog initialization and capture stops
- declining does not reduce try-on, dashboard, or lead functionality

**Transport**

- PostHog endpoint `https://us.i.posthog.com`
- successful ingestion responses received
- client-only analytics confirmed (no server-side PostHog)

**Live events verified**

`$pageview`, `try_on_started`, `try_on_completed`, `lead_form_viewed`, `lead_submitted`,
`dashboard_leads_viewed`

**Event privacy confirmed on live payloads**

- `route_group` uses normalized values only
- merchant/product dynamic URL and slugs are not transmitted
- no raw current URL, path, or host
- no referrer data
- no browser/OS/device fingerprint metadata and no raw user agent
- no timezone, screen, or viewport metadata
- no customer name, email, or phone
- no lead ID, Dekhlo try-on session ID, brand/product ID, or Supabase user ID
- no customer image/file data, signed URLs, or storage paths
- no search or free-form values
- `person_profiles = never`, `$is_identified = false`, `$process_person_profile = false`
- anonymous PostHog Distinct ID / Device ID / analytics Session ID retained only as anonymous
  analytics identifiers

**PostHog-side privacy**

- `$geoip_disable = true` verified on fresh events
- GeoIP-derived city, country, latitude, longitude, postal code, subdivision, and timezone absent
  on fresh events
- PostHog project client-IP discard setting enabled
- raw IP address absent on fresh events

**Automatic event firewall**

Runtime Activity inspection confirmed no `$autocapture`, `$snapshot`, `$dead_click`,
`$exception`, `$pageleave`, `$identify`, `$create_alias`, or `$feature_flag_called` events.

**Temporary debugging settings**

The local-only `disable_compression: true` payload-inspection override was removed before commit;
the repository contains no occurrence of it. `advanced_disable_flags` was deliberately not added.

**Also verified during earlier passes**

- uploader, lead form, and person-photo areas carry no-capture protection
- Sentry behavior unchanged from the Phase 8C.1 privacy rules
- no consent-banner flash during hydration for a stored decision

---

## 16. Future Phase 8C.3+ (not started)

Further observability work (additional analytics events, merchant identity policy, browser Sentry review) remains deferred until explicitly approved.

Phase 8C.2 runtime verification is complete, but the phase stays open until the pending
production dependency advisory is remediated.
