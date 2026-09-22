# Phase 8C — Observability and privacy-safe error handling

**Status:** Phases 8C.1, 8C.2 and 8C.3 are all **runtime verified and closed**. Phase 8C.4 is **open**
— its preflight is done and slices 8C.4A, 8C.4D, 8C.4E and 8C.4F have landed. Render **staging** is
deployed and its Supabase connectivity is proven; the Inngest staging sync is pending a redeploy with
`INNGEST_TRY_ON_CONCURRENCY=5`. No production service exists.  
**Branch:** `B2B-saas-implementation`  
**Next.js:** `16.3.5` (upgraded from `16.2.11` in slice 8C.4E to clear two critical advisories)

**Hosting decision (Phase 8C.4C):** the first production/staging target is a **Render Web Service**,
chosen because `/api/demo/try-on` multipart requests can exceed Vercel's 4.5 MB function body limit.
Render fronts every public web service with **Cloudflare**, which is why `CF-Connecting-IP` — not
`X-Forwarded-For` — is the trusted client address for IP rate limiting (section 21).

| Phase | Scope | Status | Commits |
|---|---|---|---|
| 8C.1 | Server-side Sentry, deep scrubbing, client-safe error sanitization | closed | `7a4b452`, `2e1767e`, `eedee8a` |
| 8C.2 | Consent-gated PostHog analytics with an outbound event firewall | closed | `53bbaab`, `defef8d`, `c030594`, `1ea433e` |
| 8C.3 | Request boundaries, fail-closed rate limiting, Report-Only browser security policy | closed | `1fb236b`, `6915320`, `7bd5e30` |
| 8C.4 | Production readiness. 8C.4A fixed the Supabase readiness probe; 8C.4D fixed trusted client-IP resolution; 8C.4E patched the Next.js/Sharp advisories; 8C.4F made Inngest concurrency configurable for staging | **open** | see sections 20–23 |

Phase 8C.3 closure carries two documented coverage boundaries — lead and demo limiter exhaustion is
covered by automated tests rather than manual runtime checks, and the browser CSP observation covered
public surfaces only. Both are detailed in section 19. CSP remains **Report-Only**; enforcement,
framing policy and COOP/CORP/COEP are deferred.

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

## 15. Phase 8C.2 — privacy-safe PostHog analytics

**Status: RUNTIME VERIFIED AND CLOSED**

**Package:** `posthog-js@1.421.2` (client-only; no `@posthog/next`, no server-side PostHog)

**Implementation commits:**

| Commit | Subject |
|--------|---------|
| `53bbaab` | feat: add privacy-safe product analytics |
| `defef8d` | fix: harden analytics consent and event privacy |
| `c030594` | chore: patch browserslist security advisories |

**Architecture summary:** client-side only; explicit analytics consent required; three consent
states (`undecided`, `accepted`, `declined`) plus an internal `resolving` hydration status that is
never treated as a consent choice; PostHog initializes only after accepted consent; missing
configuration safely no-ops; no server-side PostHog; no merchant `identify()`; no shopper
`identify()`; no `alias()`; `person_profiles = "never"`; `persistence = "localStorage"`.

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

The GeoIP behavior was runtime verified on fresh events (see section 15a). The PostHog project
client-IP discard setting is also enabled. This is a data-minimization measure and is not a claim
of legal compliance.

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

## 15a. Phase 8C.2 runtime verification (passed)

Executed manually against a local build with PostHog configured. All items below passed.

### Consent — undecided

- missing consent cookie resolves to `undecided`
- consent banner displayed
- PostHog not initialized
- zero PostHog requests
- site remained functional

### Consent — declined

- Decline writes `dekhlo-analytics-consent` with `v = 1`, `state = declined`, and a timestamp only
- no PII in the consent cookie
- banner closes immediately
- `declined` survives refresh
- main consent banner remains hidden after refresh
- no hydration flash for valid `declined` consent
- zero PostHog requests
- try-on, dashboard, and lead functionality remain available

### Consent — Analytics preferences

- `Analytics preferences` does not reset a valid choice to `undecided`
- the stored `declined` choice is displayed
- the user can change from `declined` to `accepted`
- the user can later change from `accepted` to `declined`

### Consent — accepted

- `accepted` cookie survives refresh
- PostHog initializes successfully
- requests sent to `https://us.i.posthog.com`
- successful ingestion verified
- no localhost-relative PostHog host remains

### Consent — accepted -> declined

- declining after PostHog initialization stops future analytics capture
- refresh after declining produces zero PostHog requests
- no application functionality is removed

### Live events verified

`$pageview`, `try_on_started`, `try_on_completed`, `lead_form_viewed`, `lead_submitted`,
`dashboard_leads_viewed`

Automated coverage exists for the remaining approved V1 event names (`signup_started`,
`signup_completed`, `brand_created`, `product_created`, `try_on_failed`), which are asserted
through the event allowlist and firewall unit tests rather than observed live.

### Pageview privacy

- the dynamic merchant route was normalized
- `/try/<brandSlug>/<productSlug>` was **not** transmitted
- `route_group = /try` was transmitted instead
- the dashboard route normalized to `/dashboard/leads`
- the auth page normalized to `/auth`
- raw search parameters were not transmitted

### Event-property privacy

Runtime inspection confirmed **no** shopper name, shopper email, shopper phone, lead ID, Dekhlo
try-on session ID, brand ID, product ID, brand slug, product slug, Supabase user ID, filename,
uploaded image, image preview, signed URL, storage path, search text, free-form reason,
provider/OpenAI error message, cookie, or authorization token.

Allowed Dekhlo application properties remain `surface`, `outcome`, `error_category`,
`consent_version`, `route_group`.

### SDK metadata firewall

`before_send` is the final outbound allowlist/firewall. Allowed events are `$pageview` plus the
ten approved Dekhlo V1 events; all unknown and automatic events are dropped.

Runtime and automated verification confirmed no `$autocapture`, `$snapshot`, `$dead_click`,
`$exception`, `$pageleave`, `$identify`, `$create_alias`, or `$feature_flag_called` events.

The firewall strips SDK-added fields including raw current URL, host, pathname, referrer,
session-entry URL/referrer attribution, browser, OS, device metadata, raw user agent, screen
dimensions, viewport dimensions, timezone metadata, page title, feature-flag metadata, and SDK
debug/capability metadata.

Retained anonymous technical identifiers may include `distinct_id`, `$device_id`, `$session_id`,
`$insert_id`, `$time`, `$lib`, `$lib_version`, and `$sdk_dist_channel`.

> `$session_id` is a PostHog-generated **anonymous analytics session identifier** and is **NOT** a
> Dekhlo `try_on_session_id`.

### Identity and person processing

- `$is_identified = false`
- `$process_person_profile = false`
- PostHog showed no person profile associated with the anonymous Distinct ID

No analytics identity was correlated to lead rows, Supabase users, merchant accounts, or shopper
PII.

### Persistence

- `persistence = localStorage`
- no PostHog analytics identity cookie required
- `dekhlo-analytics-consent` remains the separate first-party consent cookie

### GeoIP / IP privacy

**Application-side:** `$geoip_disable = true` is forced centrally on every permitted outbound
event, and application callers cannot override it.

Runtime verification on newly-created events confirmed the absence of GeoIP-derived city,
country, continent, latitude, longitude, postal code, subdivision, and GeoIP timezone.

**Project-side PostHog configuration:** the client IP discard setting is enabled, and fresh events
were verified without a stored raw IP address.

### Capture and product settings verified

```typescript
autocapture = false
capture_pageview = false
capture_pageleave = false
capture_dead_clicks = false
capture_exceptions = false
capture_heatmaps = false
capture_performance = false
disable_session_recording = true
disable_surveys = true
disable_scroll_properties = true
disableDeviceModel = true
save_referrer = false
save_campaign_params = false
person_profiles = "never"
persistence = "localStorage"
```

Feature-flag related restrictions remain enabled as implemented.
`advanced_disable_flags` was deliberately **not** added.

### No-capture surfaces

Defense-in-depth protection using `data-ph-no-capture` and `ph-no-capture` on:

- the shopper uploader
- the person-photo try-on area
- the entire lead capture form

### Temporary debugging

`disable_compression: true` was used temporarily for local payload inspection only. It was removed
before commit, and a repository search confirmed no active `disable_compression` override remains.

### Dependency security

| | |
|---|---|
| Browserslist | `4.28.6` -> `4.28.9` |
| Commit | `c030594` chore: patch browserslist security advisories |
| Override needed | No |
| Files changed for remediation | `package-lock.json` only |
| Production dependency path | Sentry -> Babel build tooling |
| Final production audit | **0 vulnerabilities** |

The **full** `npm audit` (including dev dependencies) still reports two dev-only high advisories in
ESLint/tooling dependencies: `brace-expansion` under `minimatch@3.x`, and `js-yaml` in ESLint
tooling. Both are excluded from the production dependency tree and are tracked and documented
rather than force-upgraded. A full `npm audit` is therefore **not** clean; only
`npm audit --omit=dev` is.

See `docs/dependency-security-review-2026-07.md` for advisory IDs and the full dependency path.

### Legal / privacy note

Analytics consent text, cookie duration, and the production privacy policy require appropriate
legal/privacy review. This implementation makes **no** claim of GDPR, PECA, CCPA, or any other
legal compliance.

---

## 16. Phase 8C.3A — isolated request and production-safety guards

Phase 8C.3 is split into slices. **8C.3A is this slice only**: four isolated guards drawn from the
Phase 8C.3 preflight audit (H3, M2, M5, L2). Rate-limit fail-closed policy and security headers are
deliberately **not** part of this slice.

Phase 8C.3 is **runtime verified and closed** — see section 19. Runtime verification for 8C.3A is
recorded in section 19.1.

### Scope

| Finding | Change |
|---|---|
| H3 | Session-create JSON body bound (4096 bytes) |
| M2 | Inngest dev mode impossible under `NODE_ENV=production` |
| M5 | Demo multipart body bound (20 MB) |
| L2 | UUID validation on the three session-id routes |

Explicitly **out of scope** in 8C.3A: lead/admin rate-limit fail-closed behavior, security headers
and CSP, and the L1 session existence-oracle normalization (still deferred).

### Content-Length is an early guard, not a hard cap

Both new body bounds are implemented as `Content-Length` inspection **before** body parsing, via the
shared predicate `exceedsContentLengthLimit()` in `lib/api/body-limits.ts`.

This is an **early rejection guard, not a mathematically complete streaming bound**. A request that
omits `Content-Length` — for example chunked transfer encoding — is not caught by it and still
reaches the body parser. The guard therefore does not replace, and is not a substitute for:

- schema validation of the parsed body,
- the per-file image size validation on the demo route,
- upstream platform or proxy request limits.

No streaming parser and no global request-body framework were introduced. The predicate reproduces
the semantics already used by the Phase 8B lead and Phase 8A platform handlers: a missing or
unparseable header falls through to normal parsing, and a body exactly at the limit is allowed.

### Session-create JSON bound (H3)

`POST /api/try-on/sessions` accepts four short fields (`brandSlug` ≤120, `productSlug` ≤120,
`clientRequestId` UUID, `consentToStore` boolean).

| | |
|---|---|
| Constant | `TRY_ON_MAX_JSON_BODY_BYTES = 4096` (`lib/try-on/sessions/constants.ts`) |
| Enforced | After content-type and same-origin checks, **before** `request.json()` |
| Oversized response | `400` `{"error":"Request body is too large."}`, `Cache-Control: no-store` |
| Malformed JSON | Unchanged — existing generic `400 Invalid JSON body.` |
| Missing `Content-Length` | Follows the normal parsing path |

This bound is **unrelated to shopper image upload size**, which remains bounded separately by
`PERSON_PHOTO_MAX_BYTES` (8 MB) and by the signed-upload contract. The two constants are asserted
distinct in tests.

### Demo multipart bound (M5)

| | |
|---|---|
| Constant | `DEMO_MAX_MULTIPART_BODY_BYTES = 20 * 1024 * 1024` (`lib/try-on/demo-constants.ts`) |
| Enforced | Before `request.formData()`, after the kill switch, same-origin and demo rate limits |
| Oversized response | `413` `{"error":"Request body is too large."}`, `Cache-Control: no-store` |
| Missing `Content-Length` | Follows the normal parsing path |

The bound accommodates two maximum-size images (8 MB each) plus multipart framing overhead, so
legitimate near-limit submissions are not rejected by the total bound alone. The existing **per-file
8 MB validation is unchanged** and remains the authoritative image size check. The guard is placed
after the rate limiters so an oversized attempt still consumes the attacker's own demo quota.

Unchanged in this slice: demo kill switch, same-origin validation, demo rate limits, OpenAI
behavior, image validation, and generation logic.

### Inngest production dev-mode guard (M2)

Dev mode disables Inngest request signature verification. Previously `INNGEST_DEV=1` alone enabled
it, so the value leaking into a production environment would have left `/api/inngest` willing to
accept unsigned invocations of the generation and cleanup workers.

`lib/inngest/env.ts` now resolves dev mode through a pure, injectable-env function:

| `NODE_ENV` | `INNGEST_DEV` | Dev mode |
|---|---|---|
| `production` | `1` | **`false`** |
| `development` | `1` | `true` |
| unset | `1` | `true` |
| any | absent | `false` |

`assertInngestEventSendingConfigured()` consequently still **fails closed** in production when
`INNGEST_EVENT_KEY` is absent, even if `INNGEST_DEV=1` is present.

Unchanged: Inngest functions, event names, retries, signing architecture,
`process-try-on-generation`, the cleanup function, and event-sending semantics.

### UUID validation on session routes (L2)

`isValidTryOnSessionId()` (`lib/try-on/sessions/session-id.ts`) validates the dynamic segment before
any authorization or database work on:

- `GET /api/try-on/sessions/[sessionId]`
- `POST /api/try-on/sessions/[sessionId]/generate`
- `POST /api/try-on/sessions/[sessionId]/validate-upload`

It uses the same `z.string().uuid()` semantics as the Phase 8B lead route. A malformed session id
returns a generic `404 Session not found.` with `Cache-Control: no-store` — the **same status and
message** as a missing session, so malformed input cannot be distinguished from a nonexistent
resource. No Supabase authorization lookup runs for a malformed id.

The valid-session authentication contract is unchanged: the session cookie is still required, and
expired, deleted, and token-mismatch behavior is untouched in this slice. **L1 normalization of the
404/403 existence oracle remains deferred.**

### Files changed

| File | Change |
|---|---|
| `lib/api/body-limits.ts` | New — shared `exceedsContentLengthLimit()` predicate |
| `lib/try-on/demo-constants.ts` | New — `DEMO_MAX_MULTIPART_BODY_BYTES` |
| `lib/try-on/sessions/session-id.ts` | New — UUID validation + shared not-found message |
| `lib/try-on/sessions/constants.ts` | Added `TRY_ON_MAX_JSON_BODY_BYTES` |
| `app/api/try-on/sessions/route.ts` | JSON body guard before parsing |
| `lib/try-on/demo-handler.ts` | Multipart guard before `formData()` |
| `lib/inngest/env.ts` | `resolveInngestDevMode()` production guard |
| `app/api/try-on/sessions/[sessionId]/route.ts` | UUID guard |
| `app/api/try-on/sessions/[sessionId]/generate/route.ts` | UUID guard |
| `app/api/try-on/sessions/[sessionId]/validate-upload/route.ts` | UUID guard |
| `tests/unit/phase8c3a-request-guards.test.ts` | New — 28 tests |

### No database changes

Phase 8C.3A makes **no** schema, RLS, RPC, migration, or storage-policy change. Credit semantics,
retention rules, and lead business behavior are untouched. Sentry and PostHog behavior is unchanged.

### Tests

`tests/unit/phase8c3a-request-guards.test.ts` covers behavior and source-contract regression:

- Content-Length predicate: oversized rejected, exactly-at-limit allowed, missing and unparseable
  headers fall through, and the advisory-only limitation is documented in source.
- Session-create: 4096-byte bound, realistic payload well under it, inflated payload rejected, guard
  ordered before `request.json()`, generic `400` responses preserved, bound distinct from the image bound.
- Demo: 20 MB bound, two 8 MB images plus overhead admitted, oversized rejected, missing header
  unchanged, guard ordered before `formData()` returning `413`, per-file 8 MB validation intact.
- Session ids: canonical UUIDs accepted, nine malformed forms rejected, not-found message identical
  to the missing-session message, and all three routes validate before `authorizeSessionAccess`.
- Inngest: production never enters dev mode, development still does, absent `INNGEST_DEV` disabled,
  and production event-key configuration still fails closed.

### Phase 8C.3A regression

| Check | Result |
|---|---|
| pgTAP | 360 pass |
| Unit tests | 272 -> **300** pass (28 new) |
| TypeScript | pass |
| Lint | 4 warnings, 0 errors (baseline unchanged) |
| Build | pass, Next.js 16.2.11 unchanged |
| `npm audit --omit=dev` | 0 vulnerabilities |

### Runtime verification — PASSED

Phase 8C.3A is runtime verified; the observations are recorded in section 19.1.

---

## 17. Phase 8C.3B — fail-closed rate-limit infrastructure

Second Phase 8C.3 slice. Addresses preflight findings **H1** (Upstash timeout failed open), **M4**
(lead limiter failures surfaced as 500) and **M1** (platform credit mutations had no application
limiter). Security headers and CSP remain out of scope.

Phase 8C.3 is **runtime verified and closed** — see section 19. Runtime verification for 8C.3B is
recorded in section 19.2.

### The fail-open defect

`@upstash/ratelimit@2.0.8` defaults `timeout` to 5000 ms and, when that timeout wins its internal
race, **resolves** rather than rejects — with `success: true` and `reason: "timeout"`. The previous
Dekhlo wrapper forwarded `success` and discarded `reason`, so a slow Redis silently lifted every
limit on the public lead endpoint. Verified directly against the installed package, and a unit test
now reads `node_modules/@upstash/ratelimit/dist/index.mjs` so the behavior stays pinned.

### Three-valued decision model

A boolean cannot distinguish "evaluated and within the limit" from "never evaluated", so
`lib/rate-limit/decision.ts` replaces it with an explicit outcome:

| Outcome | Meaning | HTTP |
|---|---|---|
| `allowed` | Provider evaluated the request and the limit was not exceeded | continue |
| `limited` | Provider evaluated the request and the limit **was** exceeded | **429** |
| `unavailable` | Provider was not consulted, or its answer cannot be trusted | **503** |

`unavailable` covers: Upstash timeout (`reason: "timeout"`), network/DNS exceptions, missing
production credentials, an unresolvable rate-limit hash secret, and malformed or unexpected provider
responses (non-object, missing `success`, non-boolean `success`).

The documented reasons `cacheBlock` and `denyList` accompany a **real** denial and remain ordinary
rate limiting, not `unavailable`.

`combineRateLimitDecisions()` reduces several verdicts for one request. Precedence: a definite
denial wins over `unavailable` — both reject, and 429 is the more precise answer when at least one
limit is known to be exceeded. An empty verdict set is `unavailable`, never `allowed`.

### Explicit provider timeout

`UPSTASH_LIMIT_TIMEOUT_MS = 2000` is passed as the documented `timeout` option on every
Upstash-backed limiter — tighter than the 5000 ms library default. A timeout is classified
`unavailable`; `success: true` is never trusted when `reason` is `timeout`.

Limiter construction and evaluation are wrapped so that **no** initialization or provider failure
escapes as an unhandled rejection. The memoized limiter promise is cleared on failure so a later
request retries instead of inheriting a permanently rejected promise.

### Production vs development

Unchanged: when Upstash configuration is intentionally absent in local development, the in-memory
limiter is still used and limits still apply per process. In **production** a missing
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` throws inside limiter construction, which the
wrapper converts to `unavailable` — so production fails closed instead of silently downgrading.

**No threshold or window changed in this slice.**

### All rate-limiter callers and namespaces

Audited from source; these are the complete set. No additional callers were found.

| Namespace | Limit | Window | Caller |
|---|---|---|---|
| `lead-session` | 5 | 1 h | public lead POST |
| `lead-ip` | 30 | 1 h | public lead POST |
| `lead-global` | 200 | 1 h | public lead POST |
| `tryon-session-create` | 20 | 1 h | try-on session create |
| `demo-ip` | 30 | 1 h | public demo |
| `demo-cookie` | 5 | 1 d | public demo |
| `demo-global` | `DEMO_DAILY_CAP` (500) | 1 d | public demo |
| `platform-credit-actor` | **30** | **1 m** | **new** — platform credit grant/revoke |

Every caller now maps `allowed` → continue, `limited` → 429, `unavailable` → 503. No public route
interprets infrastructure failure as success, and no infrastructure failure is reported as 429.

### Public lead POST (H1, M4)

All three limits are preserved unchanged. Previously a limiter exception propagated as an unhandled
500 and a timeout was treated as success; now:

- any limiter denies → **429** (unchanged message)
- timeout, exception, missing production configuration, or malformed response → **503**
  `Service temporarily unavailable.`

`create_try_on_lead` does not run and no lead is created on either path — the fail-closed return
precedes the RPC. Responses stay `Cache-Control: no-store`, and no provider name, timeout detail,
credential state, or network diagnostic reaches the client.

### Try-on session create

Threshold, window and route position unchanged; no ordering bug was found. `limited` → 429,
`unavailable` → 503. Neither path inserts a session row or reserves a credit. The previous
catch-all `try/catch` around the limiter is gone, replaced by explicit outcome handling.

### Public demo

Both limiter blocks (network `demo-ip` + `demo-global`, then `demo-cookie`) corrected. The handler
previously caught limiter failures and returned **429**, conflating infrastructure failure with a
real denial; it now returns **503** for `unavailable`. No OpenAI generation runs after an
`unavailable` verdict. Kill switch, same-origin check, the Phase 8C.3A multipart bound, per-file
8 MB validation, thresholds, and generation behavior for allowed traffic are unchanged.

### Platform credit mutation limiter (M1)

Applies to `POST /api/platform/credits/grant` and `POST /api/platform/credits/revoke`.

| | |
|---|---|
| Limit | 30 per minute per authenticated platform admin actor |
| Namespace | `platform-credit-actor`, shared by grant **and** revoke |
| Order | authentication → platform authorization → **limiter** → body validation → RPC |
| Limited | 429 |
| Unavailable | 503 |

Existing controls remain authoritative; the limiter is **defence in depth only**. Session
authentication, `loadPlatformAdminProfile` / `isPlatformAdminProfile`, the DB-side `platform_admin`
recheck, server-derived `p_actor`, idempotency, advisory-lock atomicity and immutable audit logs are
all unchanged.

Because the limiter runs after authorization, unauthenticated (401) and non-platform-admin (403)
traffic never consumes an actor bucket — a merchant owner or admin role alone cannot reach it.

**"Attempt" means a limiter-approved HTTP mutation request, not a successful database mutation.** One
unit is consumed per authenticated platform-admin request that reaches the limiter, before body
validation and before the RPC, so a looping or repeatedly-failing client cannot flood the database.

Grant and revoke deliberately share one bucket. Separate per-operation buckets would effectively
double the intended per-actor budget.

On either 429 or 503: no credit RPC executes, no credit is mutated, no audit or ledger row is
written, and RPC arguments and idempotency behavior are untouched.

### Platform actor identifier privacy

The raw Supabase user UUID is **never** the limiter key and is never logged. `limitPlatformCreditMutation`
derives a deterministic namespaced HMAC-SHA256 identifier via
`hashRateLimitIdentifier(namespace, value, secret)` in `lib/rate-limit/identifier-hash.ts`. The
namespace is part of the HMAC message, so the same input hashed for two limiters cannot be correlated
across namespaces.

`hashLeadRateLimitIp` is **deliberately left intact**. It uses a salted SHA-256 over `secret:value`;
re-basing it on HMAC would rotate every live lead rate-limit key mid-window. The generic helper is
therefore additive and used for new identifiers only, and a test pins the lead construction.

Secret: the existing `LEAD_RATE_LIMIT_HASH_SECRET` is reused through a new neutral accessor
`getRateLimitHashSecret()`. **No second secret was introduced and no production env var was renamed.**
The variable is now semantically broader than lead capture — a documented, deliberate decision. If
the secret cannot be resolved (production, unset), the verdict is `unavailable` and the request fails
closed.

### Observability decision

Expected 429 denials are **not** sent to Sentry, consistent with the Phase 8C.1 capture policy.

`unavailable` 503 paths are also **not** captured in this slice. Capturing per request would emit one
Sentry event for every rejected request during a provider outage, and no rate-controlled operational
mechanism exists yet; building one is out of scope here. The rate-limit module contains no Sentry or
PostHog calls, and logs no raw IP, actor UUID, hashed identifier, lead PII, session token or cookie.

### Trusted-proxy assumption — SUPERSEDED BY PHASE 8C.4D

> **This assumption did not survive host selection. See section 21.**
>
> At the time of 8C.3B, `getClientIp` header selection was left unchanged and its safety was
> assumed to rest on the production reverse proxy *overwriting or sanitizing*
> `X-Forwarded-For`, with the header trust policy to be reviewed once the host was known.
>
> Phase 8C.4C selected a **Render Web Service**, and that review found the assumption false
> for this host: Render fronts every public web service with Cloudflare, and Cloudflare
> documents that it **appends** to an existing `X-Forwarded-For` chain rather than replacing
> it. The first entry is therefore caller-controlled, exactly the failure mode 8C.3B flagged
> as hypothetical. Phase 8C.4D removed `getClientIp` and replaced it with a trusted resolver.
>
> Nothing below this note about limiter thresholds, windows, namespaces or the three-valued
> decision model changed. Only the client-address source did.

`getClientIp` header-selection logic was **unchanged** in this slice, and no hop-count logic was
implemented, as that would have required deployment evidence. That evidence arrived in 8C.4C.

### Files changed

| File | Change |
|---|---|
| `lib/rate-limit/decision.ts` | New — three-valued model, Upstash classifier, verdict combination |
| `lib/rate-limit/identifier-hash.ts` | New — generic namespaced HMAC identifier helper |
| `lib/rate-limit/index.ts` | 2000 ms timeout, fail-closed lazy limiters, platform limiter, proxy note |
| `lib/rate-limit/lead-ip-hash.ts` | Unchanged (intentionally) |
| `lib/env.ts` | Added `getRateLimitHashSecret()` accessor |
| `lib/api/security.ts` | Added `serviceUnavailableResponse()` (503, no-store) |
| `lib/leads/handle-lead-capture.ts` | 429 vs 503, fails closed before the lead RPC |
| `app/api/try-on/sessions/route.ts` | 429 vs 503, replaced catch-all |
| `lib/try-on/demo-handler.ts` | 429 vs 503 on both limiter blocks |
| `lib/platform/handle-credit-mutation.ts` | Actor limiter after authn/authz, before validation and RPC |
| `tests/unit/phase8c3b-rate-limit-failclosed.test.ts` | New — 50 tests |

### No database changes

Phase 8C.3B makes **no** schema, RLS, RPC, migration or storage-policy change. Credit RPC semantics,
lead schema and business semantics, retention, and OpenAI/Inngest generation architecture are
untouched. Sentry and PostHog behavior is unchanged.

### Phase 8C.3B regression

| Check | Result |
|---|---|
| pgTAP | 360 pass |
| Unit tests | 300 -> **350** pass (50 new) |
| TypeScript | pass |
| Lint | 4 warnings, 0 errors (baseline unchanged) |
| Build | pass, Next.js 16.2.11 unchanged |
| `npm audit --omit=dev` | 0 vulnerabilities |

### Runtime verification — PASSED (with a documented coverage boundary)

Phase 8C.3B is runtime verified; the observations, and the limits of what was manually exercised,
are recorded in section 19.2.

---

## 18. Phase 8C.3C — browser security headers and CSP Report-Only

Third Phase 8C.3 slice. Addresses the preflight security-header finding. **No CSP is enforced**: the
purpose of this slice is to observe real application requirements before enforcement.

Phase 8C.3 is **runtime verified and closed** — see section 19. Runtime verification for 8C.3C is
recorded in section 19.3.

### Where headers are configured

`lib/security/headers.mjs` is a plain ESM builder imported by `next.config.mjs`, which applies the
set to every route via `headers()` with `source: "/:path*"`. Plain ESM (not TypeScript) so the Next.js
config can import it directly while unit tests exercise the same builders rather than a copy.

The builder reads **only** `NODE_ENV`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_POSTHOG_HOST`. A
test enumerates every `env.*` read in the module and fails if anything other than `NODE_ENV` or a
`NEXT_PUBLIC_` variable appears, so a server-only secret cannot drift into a response header.

### Emitted headers

| Header | Value | Scope |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | all environments |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | all environments |
| `Permissions-Policy` | `camera=(self), geolocation=(), microphone=()` | all environments |
| `Content-Security-Policy-Report-Only` | see below | all environments |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | **production only** |

`camera=(self)` is deliberate rather than `camera=()`: shopper image capture may legitimately use the
local device camera. `preload` is deliberately **not** added to HSTS in this phase, and HSTS is not
emitted in local development where it is meaningless over plain http and would poison the localhost
origin in the developer's browser.

### Report-Only CSP

Production policy:

```
default-src 'self';
base-uri 'self';
object-src 'none';
form-action 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: <supabase-origin>;
font-src 'self' data:;
connect-src 'self' <supabase-origin> <posthog-origin>;
worker-src 'self' blob:
```

Development differs in exactly two ways, and the production policy was not weakened to accommodate
either:

- `script-src` additionally allows `'unsafe-eval'`, which Next.js dev tooling (webpack HMR, React
  Refresh) requires. Production App Router output does not evaluate generated code, so
  `'unsafe-eval'` never reaches the production policy — enforced by a test.
- `connect-src` additionally allows `ws://localhost:*` and `ws://127.0.0.1:*` for the HMR websocket.
  CSP3 `'self'` should cover a same-origin `ws://` upgrade, but browser behavior has varied.

Directive rationale, verified against actual source rather than assumed:

- `script-src 'unsafe-inline'` — required until App Router bootstrap payloads are nonce-tagged via
  middleware, which is an enforcement-phase change.
- `style-src 'unsafe-inline'` — Tailwind and Next.js inject inline style attributes.
- `img-src data:` — the demo flow returns a base64 `data:image/png` result.
- `img-src blob:` — uploader and product-form previews use `URL.createObjectURL`.
- `worker-src blob:` — keeps Blob-backed workers available to client libraries.

### Derived external origins

Only two, both from public configuration, both reduced to a bare origin via `new URL().origin`:

| Source | From | Used for |
|---|---|---|
| Supabase origin | `NEXT_PUBLIC_SUPABASE_URL` | `img-src` (product and signed images), `connect-src` (auth, storage, REST) |
| PostHog origin | `NEXT_PUBLIC_POSTHOG_HOST` | `connect-src` (client ingestion) |

Paths, query strings and credentials are stripped, so a configured URL cannot carry a key, token or
DSN fragment into a header. Absent, empty, malformed or non-http(s) configuration yields no source at
all rather than the literal string `undefined`. When neither is configured the policy is still valid
and simply has no external origins.

### Origins deliberately absent

Not guessed at, and each verified against source:

- **OpenAI** — called only from server route handlers; the browser never contacts it.
- **Sentry** — Phase 8C.1 is server-side only; there is no browser DSN or client init.
- **Inngest** — no browser source calls Inngest directly.
- **Google Fonts** — `next/font/google` (Caprasimo, Figtree) self-hosts at build time and serves from
  `/_next/static`, so `font-src 'self'` is sufficient and no `gstatic`/`googleapis` origin is needed.
- **Supabase websockets** — no `.channel()` or realtime subscription exists in client source, so no
  `wss:` origin is included.
- **PostHog remote extension scripts** — surveys, replay and exception autocapture are all disabled in
  Phase 8C.2, so PostHog is not added to `script-src`. If the Report-Only window shows an attempted
  remote script load, that is a signal worth investigating rather than a source to pre-authorize.

No wildcard source, no wildcard host, and no bare `https:`/`http:` scheme source appears in any
directive; a test walks every directive to enforce this.

### Deliberately deferred

| Deferred | Why |
|---|---|
| Enforcing `Content-Security-Policy` | Report-Only first, so real violations are observed before anything can break |
| `X-Frame-Options` | The merchant try-on surface may later be embedded on merchant websites |
| `frame-ancestors` | Same — a blanket `DENY`/`SAMEORIGIN`/`'none'` would be a future product regression |
| `Cross-Origin-Opener-Policy` | Must be evaluated together with embedding and external-resource requirements |
| `Cross-Origin-Resource-Policy` | Same |
| `Cross-Origin-Embedder-Policy` | Same |
| HSTS `preload` | Not requested in this phase |
| `report-uri` / `report-to` | No privacy-safe collector exists; no DB-backed collector or third-party reporting service was added |

**A regression guard test** scans `lib/security/headers.mjs` and `next.config.mjs` for
`X-Frame-Options`, `frame-ancestors`, `DENY` and `SAMEORIGIN` outside comments, so a global
restrictive framing rule cannot be introduced accidentally during this phase. Dashboard and platform
framing policy will be designed together with the merchant embedding model.

### Report-Only expectations

A CSP violation in this phase **cannot break functionality** — the browser reports and continues.
Violations appearing in the DevTools console during the observation window are expected. Development-only
violations must not be suppressed by adding broad unsafe sources to the production policy.

Because no report endpoint exists, collection is manual browser-console inspection during runtime
verification.

### Files changed

| File | Change |
|---|---|
| `lib/security/headers.mjs` | New — header set and Report-Only CSP builder, origin derivation |
| `next.config.mjs` | Added `headers()` applying the set to `/:path*` |
| `tests/unit/phase8c3c-security-headers.test.ts` | New — 30 tests |

No application, authentication, RLS, credit, lead, OpenAI, Inngest, storage, retention, rate-limit,
Sentry or PostHog behavior changed. No migration.

### Phase 8C.3C regression

| Check | Result |
|---|---|
| pgTAP | 360 pass |
| Unit tests | 350 -> **380** pass (30 new) |
| TypeScript | pass |
| Lint | 4 warnings, 0 errors (baseline unchanged) |
| Build | pass, Next.js 16.2.11 unchanged |
| `npm audit --omit=dev` | 0 vulnerabilities |

### Manual CSP verification — PARTIALLY COMPLETED

Runtime results, including which surfaces were and were not observed, are recorded in section 19.3.

---

## 19. Phase 8C.3 — RUNTIME VERIFIED AND CLOSED

Phase 8C.3 is **runtime verified and closed**.

| Slice | Commit | Subject |
|---|---|---|
| 8C.3A | `1fb236b` | fix: harden try-on request boundaries |
| 8C.3B | `6915320` | fix: fail closed on rate-limit infrastructure |
| 8C.3C | `7bd5e30` | feat: add report-only browser security policy |

Closure is recorded with two explicit coverage boundaries, both documented below rather than glossed
over: lead and demo limiter exhaustion were verified by automated tests only (19.2), and the browser
CSP observation pass covered public surfaces only (19.3).

### 19.1 Phase 8C.3A runtime verification — PASSED

Operator-confirmed observations:

- Oversized `POST /api/try-on/sessions` JSON was rejected with **400 before JSON parsing**.
- The oversized request produced **no session and no credit side effect**.
- A malformed session UUID returned a **generic 404** on all three routes:
  - `GET /api/try-on/sessions/[sessionId]`
  - `POST /api/try-on/sessions/[sessionId]/generate`
  - `POST /api/try-on/sessions/[sessionId]/validate-upload`
- **No PostgreSQL UUID error was exposed** — malformed input is indistinguishable from a session that
  does not exist, so the routes remain enumeration-resistant.
- Oversized demo multipart was rejected with **413 before `formData()` and before OpenAI generation**.
- Existing completed-session restoration **still works**.
- Restoration produced **no second generation and no second reservation**.

### 19.2 Phase 8C.3B runtime verification — PASSED

Operator-confirmed observations:

- An intentionally unavailable Upstash produced **503**.
- The error response was **generic**, exposing no Upstash, Redis, timeout, credential or network
  detail.
- The unavailable limiter created **no try-on session**.
- The unavailable limiter produced **no credit side effect**.
- Platform limiter infrastructure failure produced **503 before validation and before the RPC**.
- Actual platform rate-limit exhaustion produced **429**.
- Invalid platform requests below the limit remained **ordinary validation failures**, so the limiter
  did not mask or replace normal validation behavior.
- **No credit RPC, ledger mutation or audit mutation** occurred from the invalid 429 test requests.
- **429 and 503 are therefore runtime-distinct**: an evaluated limit breach and an unevaluable limiter
  produce different, correct responses rather than a single conflated failure.

#### Coverage boundary — lead and demo limiters

Lead and demo limiter exhaustion and their fail-closed 503 paths were **not** manually exercised at
runtime. They remain covered by the Phase 8C.3B automated suite
(`tests/unit/phase8c3b-rate-limit-failclosed.test.ts`), which proves:

- the shared classifier maps `success: true` + `reason: "timeout"` to `unavailable`, pinned against
  the installed `@upstash/ratelimit` payload
- malformed and thrown provider results become `unavailable`
- lead capture answers `limited` with 429 and `unavailable` with 503, and the fail-closed return
  precedes `create_try_on_lead`
- demo answers `limited` with 429 and `unavailable` with 503 on both limiter blocks, and generation
  follows every verdict

This is **automated coverage, not a manual runtime observation**, and is recorded as such. Manual
lead and demo limiter verification remains available as a future check.

### 19.3 Phase 8C.3C runtime verification — PASSED (public surfaces)

#### Live response headers — confirmed present

Read from real responses on both a production server and the development server, on page and API
routes:

| Header | Value | Scope |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | confirmed |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | confirmed |
| `Permissions-Policy` | `camera=(self), geolocation=(), microphone=()` | confirmed |
| `Content-Security-Policy-Report-Only` | present | confirmed |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | **production only**, confirmed absent in development |

The production policy was confirmed to contain **no** `'unsafe-eval'` and no `ws://` source; the
development policy was confirmed to contain both, so development tooling did not weaken production.

#### Confirmed absent

- enforcing `Content-Security-Policy`
- `X-Frame-Options`
- `frame-ancestors`
- `Cross-Origin-Opener-Policy`
- `Cross-Origin-Resource-Policy`
- `Cross-Origin-Embedder-Policy`

#### Browser CSP observation result

The observation pass was **completely clean**: **no CSP violations of any kind** were reported on the
surfaces tested — no first-party production-relevant violations, and no development-only or
browser-extension violations either.

**Surfaces observed (public only):**

- homepage `/`
- auth (login and signup)
- merchant try-on
- upload preview
- completed result
- lead form

Supabase image loading was exercised through the merchant try-on and completed-result surfaces.

**Surfaces NOT observed in this pass:**

- dashboard `/dashboard`
- dashboard leads `/dashboard/leads`
- platform admin
- a dedicated PostHog-ingestion confirmation with consent accepted

These remain unobserved and should be checked before any future enforcement decision. A clean public
pass does not demonstrate that authenticated surfaces are violation-free.

#### CSP remains Report-Only

**A clean observation pass does not make CSP ready for enforcement**, and no enforcement is implied
by this closure. Reasons enforcement remains deferred:

- The observation covered public surfaces only; authenticated dashboard and platform surfaces are
  unobserved.
- The policy still relies on `script-src 'unsafe-inline'`, which materially weakens the main
  protection CSP offers. Dropping it requires nonce-tagging App Router bootstrap payloads via
  middleware — an implementation change, not an observation.
- A single clean pass is not an observation window; enforcement should follow sustained observation
  across real traffic.

Merchant embedding and framing policy remain **deferred**: no `X-Frame-Options` and no
`frame-ancestors` are set, and the framing decision is designed together with the merchant embedding
model. COOP, CORP and COEP remain deferred for the same reason.

### 19.4 Security invariants — reconfirmed unchanged

Phase 8C.3 changed request guards, rate-limit failure semantics and response headers only. Across all
three slices there were **no** changes to:

| Area | Status |
|---|---|
| RLS policies | unchanged |
| Schema, migrations, RPCs | unchanged — no migration was created in any 8C.3 slice |
| Service-role boundary | unchanged; credentials remain server-only |
| Credit semantics | unchanged — reserve/consume/release invariants and RPC arguments untouched |
| Lead semantics | unchanged — schema, business rules and `create_try_on_lead` untouched |
| Image and storage retention | unchanged — Phase 7 cleanup rules intact |
| OpenAI and Inngest architecture | unchanged — prompt, model, retries, event names and signing untouched |
| Sentry | unchanged — no new capture sites; 429s are not reported and 503 limiter paths are deliberately not captured |
| PostHog | unchanged — no new events, properties or configuration |

pgTAP remained at 360 passing tests throughout all three slices, which is the standing evidence that
RLS and database-level authorization boundaries did not move.

### 19.5 Final Phase 8C.3 regression

| Check | Result |
|---|---|
| pgTAP | **360 pass** (Files=20, Result: PASS) |
| Unit tests | **380 pass**, 0 fail (300 at 8C.3 start -> 350 after 8C.3B -> 380 after 8C.3C) |
| TypeScript | pass |
| Lint | 4 warnings, 0 errors (acknowledged baseline) |
| Build | pass |
| Next.js | 16.2.11 unchanged |
| `npm audit --omit=dev` | **0 vulnerabilities** |

Dependencies were not modified in this closure. The full `npm audit` still reports the two documented
dev-only high advisories in ESLint tooling (`brace-expansion` under `minimatch@3.x`, and `js-yaml`),
which are excluded from the production dependency tree and tracked rather than force-upgraded. A full
`npm audit` is **not** clean and is not claimed to be.

**Phase 8C.3 is closed.**

---

## 20. Phase 8C.4A — Supabase readiness probe correctness

Phase 8C.4 is **open**. Its preflight audit found one production blocker, and this slice fixes only
that blocker. Deployment configuration and the remaining preflight findings are untouched.

### The blocker — `getSession()` was not a connectivity probe

`verifySupabaseConnection()` proved connectivity with `supabase.auth.getSession()`. The admin client
is constructed with `persistSession: false` and never holds a stored session, so `getSession()`
resolves entirely from local state and issues **no network request at all**. It returned
`error: null` against a refused connection and against a nonexistent domain, in 0 ms.

`/api/health/supabase` therefore reported `200 {"status":"ok"}` while Supabase was completely
unreachable, making it unsafe as a deployment readiness check, an uptime dependency check and an
operator diagnostic — the three things it exists for.

### The probe now performs real database I/O

The probe issues a single bounded `SELECT` through the existing server-only admin client:

```
brands -> select("id") -> limit(1) -> abortSignal(AbortSignal.timeout(5000))
```

The old check built its own client from the **publishable (anon)** key; the probe now goes through
the existing server-only admin client, so the query is not subject to RLS and a reachable database
cannot be misreported as unhealthy because a policy filtered the row.

`public.brands` was chosen after inspecting the migrations. It is created by the first Phase 2 tenant
migration (`20260722140000_phase2_tenant_schema.sql`), is never dropped by any later migration, and
is the foundational tenant table, so it is guaranteed to exist in every environment. Only the opaque
`id` column of at most one row is requested and the row is discarded; the probe returns a boolean.

A `head: true` variant was implemented first and rejected on evidence. PostgREST answers HTTP HEAD
with an empty body, which postgrest-js surfaces as an empty-message error once Next's patched fetch
is in play, so a fully reachable database was reported unhealthy. The single-row `SELECT` is the
option the task description lists first and it behaves correctly under both plain Node and Next.

The probe performs no mutation, no RPC, no credit operation and no lead operation, and this is
asserted by test rather than left to review.

### Semantics

| Condition | Result |
|---|---|
| Successful query returning rows | healthy |
| **Successful query returning zero rows** | **healthy** |
| Provider/PostgREST error (bad key, bad relation) | unhealthy |
| Connection refused | unhealthy |
| DNS failure | unhealthy |
| Invalid or malformed Supabase URL | unhealthy |
| Timeout | unhealthy |
| Admin client cannot be constructed (missing secret) | unhealthy |

An empty table is healthy by design: the probe proves reachability, not the presence of data. The
local `brands` table is empty after `db reset` and still reports healthy, which is the direct
evidence for that row.

### Timeout and hang safety

No new timeout framework was introduced. postgrest-js 2.110.8 already supports
`.abortSignal()`, and the probe passes the native `AbortSignal.timeout(5000)` — the smallest
established mechanism available.

The signal is load-bearing rather than decorative: postgrest-js retries idempotent requests on
network errors with exponential backoff (1s, 2s, 4s, up to 3 attempts), so the retry budget alone
would let a provider outage run past 7s. Measured against unreachable origins, total probe time
tracked the supplied timeout exactly. This is unrelated to the Upstash 2000 ms rate-limit timeout.

### Endpoint contract — unchanged

The route already had the correct shape, so `app/api/health/supabase/route.ts` was **not modified**.
Recorded for the audit trail:

| Case | Status | Body |
|---|---|---|
| Healthy | `200` | `{"status":"ok"}` |
| Supabase unavailable | `503` | `{"status":"error"}` |
| Unauthorized / health access disabled | `404` | `{"status":"error"}` |

`503` was already used for dependency failure, which is the correct readiness semantic, so no status
change was needed. `Cache-Control: no-store` is preserved on every path. The body is a single
`status` field: no exception message, Supabase error object, hostname, table name, URL, credential or
stack trace reaches the caller. Failure reasons are discarded inside the probe rather than filtered
at the edge.

`INTERNAL_HEALTH_SECRET` behaviour is untouched — development still allows access, and otherwise a
missing secret or a mismatched `x-internal-health-secret` header both yield `404`. The service-role
key remains server-only; no `NEXT_PUBLIC_` access to server secrets was introduced.

The admin client is imported dynamically inside `verifySupabaseConnection()` so that
`lib/supabase/health.ts` carries no static `server-only` dependency and the probe logic stays
directly unit-testable.

### Runtime verification

Measured against the real local Supabase and against real failing origins:

| Case | Result |
|---|---|
| Reachable local Supabase, `brands` empty (0 rows) | **healthy**, 41 ms |
| Connection refused (`127.0.0.1:1`) | unhealthy, bounded at the 1500 ms timeout |
| DNS failure | unhealthy, bounded at the 1500 ms timeout |
| Reachable host, invalid credential | unhealthy, 15 ms |
| **Old `getSession()` probe, unreachable origin** | **no error — would have reported healthy, 0 ms** |

The last row is the false positive reproduced side by side with the fix, which is the clearest
statement of what changed.

The live endpoint returned `503 {"status":"error"}` with `Cache-Control: no-store` under
`next start`, and `404` for a missing and for a mismatched health secret. A live `200` from the
running server was **not** captured: the `SUPABASE_SECRET_KEY` in the developer's `.env.local` is
stale relative to the running local stack and is rejected with HTTP 401, and that file was left
untouched as instructed. Notably the old probe would have reported that same server healthy despite
it being unable to authenticate to Supabase at all, so the observed `503` is correct behaviour and is
itself evidence the fix works. The healthy path is covered by the measured probe result above and by
unit tests.

### Files changed

| File | Change |
|---|---|
| `lib/supabase/health.ts` | replaced the `getSession()` check with a bounded single-row `SELECT` through the admin client |
| `tests/unit/phase8c4a-health-probe.test.ts` | new — 19 tests covering probe outcomes, request shape, the false-positive regression and the endpoint contract |
| `app/api/health/supabase/route.ts` | unchanged — already `200`/`503`/`404` with `no-store` |

### No database or dependency changes

No migration, schema, RLS, RPC, storage, retention or dependency change. No Sentry, PostHog, Inngest,
rate-limit, credit, lead or auth change. pgTAP stayed at 360 passing tests, which is the standing
evidence that database-level authorization boundaries did not move.

### Phase 8C.4A regression

| Check | Result |
|---|---|
| pgTAP | **360 pass** (Files=20, Result: PASS) |
| Unit tests | **399 pass**, 0 fail (380 -> 399, +19) |
| TypeScript | pass |
| Lint | 4 warnings, 0 errors (acknowledged baseline) |
| Build | pass |
| Next.js | 16.2.11 unchanged |
| `npm audit --omit=dev` | **0 vulnerabilities** |

### Phase 8C.4 remains OPEN

This slice fixed the readiness probe only. Deployment configuration, the production environment
matrix, the live production-mode header and CSP checks, and the remaining preflight findings
(M1/M2/M3 and L1-L5) are **not** started. Phase 8C.4 runtime and deployment verification is still
pending and Phase 8C.4 is **not closed**.

---

## 21. Phase 8C.4D — trusted client-IP resolution for Render/Cloudflare

**Status:** implemented. Commit `fix: trust Cloudflare client IP on Render`.
**Classification:** production-blocking security fix, raised as Blocker 1 by the 8C.4C Render
hosting compatibility preflight.

### The blocker

Phase 8C.3B deferred the client-address trust decision until the host was known, resting on an
assumption that the production reverse proxy would overwrite or sanitize `X-Forwarded-For`.
Phase 8C.4C selected a **Render Web Service** and invalidated that assumption:

- Render fronts **all** inbound traffic to public web services with Cloudflare.
- Cloudflare's documented behaviour is that if an `X-Forwarded-For` header is **already
  present**, it **appends** the connecting proxy's address rather than replacing the header.
- Render's proxy then appends its own load-balancer address.
- Consequently a caller sending `X-Forwarded-For: 1.2.3.4` produced a chain whose **first entry
  was fully caller-controlled**, and `getClientIp` returned exactly that first entry.

Rotating the header therefore rotated the limiter bucket, defeating every IP-scoped limit.
Measured against the pre-fix helper, 25 spoofed header values produced **25 distinct limiter
buckets**; after the fix the same 25 requests collapse to **1 bucket** pinned to the real
Cloudflare-supplied address.

An aggravating factor worth recording: **Render's own documentation recommends the vulnerable
pattern.** Their DDoS-protection article advises reading `x-forwarded-for` and its rate-limiting
example uses `req.headers['x-forwarded-for']?.split(',')[0]` — the exact code this project had.
Render has never documented a stripping guarantee, and a 2021 feature request asking them to
provide one is still unanswered. The defect was only visible from Cloudflare's documentation.

### Trusted-IP model

New module `lib/rate-limit/client-ip.ts` (deliberately free of `server-only` so it is directly
unit-testable) exposes a typed result rather than an in-band placeholder string:

```ts
export type TrustedClientIp = { ok: true; ip: string } | { ok: false };
```

`{ ok: false }` means *no trustworthy address is available*. It is a distinct state, not an
address — the previous `"unknown"` sentinel conflated "no address" with "an address", which would
have become a single shared production bucket. There is **no shared `"unknown"` production
bucket**, and the unavailable result deliberately carries **no reason, message or detail field**
so no diagnostic text can leak into a response or a log.

| Runtime | Client-address source | No valid address |
|---|---|---|
| `NODE_ENV === "production"` | `CF-Connecting-IP` **only** | `{ ok: false }` → `unavailable` → **503** |
| any other `NODE_ENV` | `CF-Connecting-IP`, then first `X-Forwarded-For` entry, then `X-Real-IP`, then `"unknown"` | never — local development always resolves |

Production **never** consults `X-Forwarded-For`, `X-Real-IP`, `True-Client-IP` or `Forwarded`.
`True-Client-IP` was rejected as a primary source because Cloudflare documents it as
**Enterprise-plan only**, whereas `CF-Connecting-IP` is available on all plans and contains
exactly one address. Hop counting from either end of the chain was rejected because the number of
proxy hops Render adds is undocumented, making position-based parsing guesswork.

### Validation

`parseTrustedClientIp` accepts a value only if, after trimming ordinary surrounding whitespace, it
is a single syntactically valid IPv4 or IPv6 literal, verified with `isIP` from **`node:net`**. No
new dependency was introduced. Everything else is unavailable: missing header, blank header,
hostnames (`attacker.example`), malformed literals (`999.999.999.999`, `1.2.3`), decorated values
(`1.2.3.4:8080`, `[2001:db8::1]`, `1.2.3.4/24`), and any comma-separated or multi-valued string
(`"1.2.3.4, 5.6.7.8"`). Valid IPv6 is accepted, including compressed and link-local forms.

### Fail-closed behaviour

Trusted-IP failure integrates with the **existing Phase 8C.3B three-valued decision model** rather
than a second parallel failure system. It is classified `unavailable`, never `limited`, which
preserves the established split:

- **429** — a limit was actually evaluated and exceeded.
- **503** — a trustworthy rate-limit evaluation could not be performed.

The 503 reuses the existing generic `serviceUnavailableResponse()` body, `Service temporarily
unavailable.`, with `Cache-Control: no-store`. No response mentions Cloudflare, Render, a proxy, a
header name, an address or a validation reason.

| Route | Valid IP, under limit | Valid IP, limit exceeded | No trusted production IP |
|---|---|---|---|
| lead capture `POST` | normal | 429 | **503**, no `create_try_on_lead` RPC |
| `POST /api/try-on/sessions` | normal | 429 | **503**, no session row, no credit reservation |
| `/api/demo/try-on` | normal | 429 | **503**, no OpenAI generation |

In each case the fail-closed return precedes the side effect; the demo verdict is also evaluated
before the `OPENAI_API_KEY` check, so no generation path is entered.

### Affected and unaffected limiters

**Affected** (now resolve a trusted address and fail closed) — the three IP-scoped namespaces:

| Namespace | Identifier | Threshold |
|---|---|---|
| `lead-ip` | HMAC-free SHA-256 hash of the trusted address | 30 / 1 h — **unchanged** |
| `tryon-session-create` | trusted address | 20 / 1 h — **unchanged** |
| `demo-ip` | trusted address | 30 / 1 h — **unchanged** |

**Unaffected** — identifiers, thresholds and windows all untouched: `lead-session` (5/1h, session
id), `lead-global` (200/1h, `"global"`), `demo-cookie` (5/1d, cookie id), `demo-global`
(`DEMO_DAILY_CAP`/1d, `"global"`), `platform-credit-actor` (30/1m, hashed Supabase user id).

**No limiter threshold, window or namespace changed in this slice.** The three IP limiters now
receive a trustworthy identifier instead of a forgeable one; nothing else about them moved.

### Privacy

Unchanged from 8C.3B. The lead limiter still hashes the address before it reaches the store — the
limiter receives `hashed`, never `client.ip`. Neither `lib/rate-limit/client-ip.ts` nor
`lib/rate-limit/index.ts` logs anything or imports Sentry or PostHog, so no raw address, header
value or hashed identifier is logged or reported. `X-Forwarded-For` remains on the Sentry header
denylist (section 9). Only the trusted source changed.

### Hosting coupling — MUST be reviewed if the topology changes

This slice intentionally couples IP rate limiting to **Render + Cloudflare**. The assumption is
recorded in a comment at the resolver and asserted by tests. `CF-Connecting-IP` is trustworthy
**only** where Cloudflare is guaranteed to terminate every inbound request; it is **not** safe
behind an arbitrary proxy, and the source comment says so explicitly rather than making a generic
claim. Moving off Render, or Render moving off Cloudflare, invalidates the model and must force a
review before IP-scoped limits are relied on again.

### Files changed

| File | Change |
|---|---|
| `lib/rate-limit/client-ip.ts` | **new** — `TrustedClientIp`, `parseTrustedClientIp`, `resolveTrustedClientIp`, hosting-coupling comment |
| `lib/rate-limit/index.ts` | removed `getClientIp`; `limitLeadCaptureByIp` / `limitSessionCreation` / `limitDemoByIp` take `Request`, resolve trust and fail closed |
| `app/api/try-on/sessions/route.ts` | `limitSessionCreation(request)`; dropped the `getClientIp` import |
| `lib/try-on/demo-handler.ts` | `limitDemoByIp(request)`; dropped the `getClientIp` import |
| `tests/unit/phase8c4d-trusted-client-ip.test.ts` | **new** — 55 tests |
| `tests/unit/phase8c3b-rate-limit-failclosed.test.ts` | replaced the stale trusted-proxy doc assertion with a "no header parsing in this module" contract |
| `docs/supabase-phase-8c.md` | this section; superseded note on the 8C.3B trusted-proxy assumption |

No migration, no schema, RLS, RPC, storage, retention, auth, CSP, Sentry, PostHog, Inngest, OpenAI
or credit change. No dependency added or removed.

### Regression

pgTAP 360 / unit 399 → **454** (+55) / TypeScript pass / lint baseline warnings only / build pass on
Next.js 16.2.11.

**Dependency baseline deviation — not caused by this slice.** The production audit
(`npm audit --omit=dev`) moved from the previously recorded **0 vulnerabilities** to **2
(1 critical, 1 high)**. `package.json` and `package-lock.json` are untouched by 8C.4D; these are
newly published advisories against the already-pinned Next.js 16.2.11 and its bundled
`sharp@0.35.0`:

| Advisory | Severity | Applies to Dekhlo? |
|---|---|---|
| `GHSA-2xp9-vwfh-vxw4` — unauthenticated RCE in the Image Optimization API via AVIF | critical | **Not reachable.** `next.config.mjs` sets `images: { unoptimized: true }` and `next/image` is imported nowhere, so the optimizer endpoint is disabled |
| `GHSA-p293-qw3h-jr36` — unauthenticated RCE on Windows-hosted servers | critical | **Not applicable.** The Render target is a Linux container |
| `GHSA-rgj7-g3m4-5g8c` — `sharp` < 0.35.4 libheif vulnerabilities | high | Reachable only through the disabled optimizer path |

The remediation is `next@16.3.5`, which is outside the current pinned range and therefore a
dependency upgrade in its own right. It was **not** applied here: `npm audit fix` was explicitly out
of scope for this slice, and a Next.js minor upgrade needs its own regression run. This must be
resolved in a dedicated dependency slice and is added to the Phase 8C.4 blocking-before-deploy
conditions.

> **Resolved by Phase 8C.4E** (section 22). Next.js was upgraded `16.2.11 → 16.3.5` and `sharp`
> reached `0.35.4`, returning the production audit to **0 vulnerabilities**. Note that the
> "not reachable / not applicable" column above describes why the risk was *bounded while
> remediation was pending* — it is not a claim that 16.2.11 was safe, and it was not treated as a
> substitute for patching.

Because `lib/rate-limit/index.ts` is a `server-only` module that cannot be imported under the test
runner, limiter and route wiring is covered by source-contract assertions — the established pattern
from 8C.3B — while the resolver itself is covered behaviourally, including a direct
`NODE_ENV` boundary test that proves the same spoofed headers resolve in development and fail
closed in production.

### Still pending

**Staging runtime spoof-resistance verification remains pending.** The 8C.4C probe **F4** — sending
rotating fake `X-Forwarded-For` values at a deployed staging service and confirming the per-IP
limiter is no longer evaded — cannot run until a Render staging service exists. The empirical proof
recorded above is in-process, not end-to-end. Phase 8C.4 go/no-go conditions 1 and 2 are satisfied
by this slice; condition 2's *deployed* re-verification is still outstanding.

Phase 8C.4 remains **open**. No Render service has been created and nothing has been deployed.

---

## 22. Phase 8C.4E — Next.js / Sharp security advisory remediation

**Status:** implemented. Commit `chore: patch Next.js security advisories`.
**Classification:** dependency-security slice. Closes the audit deviation recorded in section 21.
Full detail lives in `docs/dependency-security-review-2026-07.md` (section dated 2026-09-15).

### Why this slice existed

Phase 8C.4D's regression run found the production audit had moved from the previously recorded
**0 vulnerabilities** to **2 (1 critical, 1 high)**. These advisories were **not introduced by
Phase 8C.4D** — commit `2f07b8d` did not touch `package.json` or `package-lock.json`. They were
published upstream after the 2026-09-07 lockfile, against the already-pinned `next@16.2.11` and the
`sharp@0.35.0` that a July 2026 override had installed as the patched version at that time.

| Advisory | Package | Severity | Patched |
|---|---|---|---|
| [GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) — unauthenticated RCE in the Image Optimization API via AVIF | `next` | critical | 16.3.3+ |
| [GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36) — unauthenticated RCE on Windows-hosted servers | `next` | critical | 16.3.3+ |
| [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) — libheif issues (GHSA-g89c-p67h-r497, GHSA-2jg2-4ch7-h545) | `sharp` | high | 0.35.4 |

### What changed

| | Before | After |
|---|---|---|
| `next` (direct, exact pin) | 16.2.11 | **16.3.5** (current `latest`) |
| `sharp` (optional under `next`) | 0.35.0, held by an override | **0.35.4** via normal transitive resolution |
| `react` / `react-dom` | 19.2.8 | **unchanged** |

The decisive detail: `package.json` carried `"next": { "sharp": "0.35.0" }`, added in July 2026 to
push `sharp` **up** past a then-vulnerable `0.34.x` because `next@16.2.11` declared
`optionalDependencies.sharp: "^0.34.5"`. Since `next@16.3.5` declares `^0.35.4`, that override had
inverted its purpose and would now have **pinned `sharp` down** at the vulnerable `0.35.0`,
silently defeating the upgrade. It was **removed** so ordinary resolution supplies the patched
release. **No new override was added and no direct `sharp` dependency was introduced.**
`next.postcss → $postcss` was kept, since `next@16.3.5` still nests its own `postcss@8.5.23`.

The lockfile diff is **0 packages added, 0 removed, 38 versions changed**, confined to `next`, its
SWC binaries, `@next/env`, `@swc/helpers`, `sharp` and the `@img/sharp-*` platform packages. No
unrelated direct dependency was upgraded, and `npm audit fix` was not run in any form.

### Compatibility

**No application code change was required.** `16.3` is a performance/feature release; the breaking
App Router changes were in `16.0`, which this project already ran. The repo is already on the
`proxy.ts` convention rather than the deprecated `middleware.ts`, and uses none of the APIs removed
in 16.x. `headers()`, `experimental.serverActions.bodySizeLimit`, `images.unoptimized`,
`instrumentation.ts`, the Sentry integration and the Turbopack build are all unaffected.

The only source edit is a corrected comment in `next.config.mjs`, which had described
`images.unoptimized` as temporary pending a patched sharp — a precondition this upgrade satisfied,
making the comment actively misleading about whether the optimizer may now be enabled.

One new **non-blocking** deprecation warning appeared: the build reports that the Edge Runtime is
deprecated, because pre-existing code in `app/opengraph-image.tsx` sets
`export const runtime = "edge"`. The build succeeds; this was deliberately not changed, since
moving that route to the Node runtime is an application behavior change. Tracked as follow-up.

### Security controls re-verified

All Phase 8C controls were re-confirmed against a live production server on Next.js 16.3.5:
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` unchanged, `Strict-Transport-Security: max-age=31536000; includeSubDomains`,
and CSP still **Report-Only**. No enforcing CSP, no `X-Frame-Options`, no `frame-ancestors`, no
COOP/CORP/COEP, no `'unsafe-eval'`, no development websocket sources.

Route behavior coverage is intact — every security suite passes: request guards (28), rate-limit
fail-closed (50), security headers (30), health probe (19), trusted client IP (55), Sentry scrubber
(18), PostHog firewall (36), lead contract (7). No threshold or semantic was altered.

### Regression

pgTAP **360** / unit **454** / TypeScript pass / lint 0 errors + 4 baseline warnings / build pass on
**Next.js 16.3.5** / production `npm audit` **0 vulnerabilities**.

Production start smoke on port 3020, with no OpenAI call and no credit consumed: `/` 200,
`/auth/login` 200, `/demo` 200, `/try/nope/nope` 404, `/dashboard` 307 →
`/auth/login?next=%2Fdashboard`, `/platform` 307 → `/auth/login?next=%2Fplatform`.

### Honest scope of the mitigation argument

Dekhlo's disabled image optimizer and Linux deployment target meant practical exposure to both
critical advisories was limited. That is **not** a claim that `next@16.2.11` was safe: a disabled
feature is a configuration choice, not a security boundary, and it says nothing about code paths
outside the optimizer. The vulnerable version was replaced rather than reasoned around.

The full audit is **not** clean and is not claimed to be. Two high-severity **dev-only** findings
remain, absent from the `--omit=dev` tree and not installed by `npm ci --omit=dev`:
`brace-expansion@1.1.16` under the ESLint `minimatch@3.x` paths, and `js-yaml@4.3.0` under
`eslint → @eslint/eslintrc`. **Production audit is the release gate**, and it is at 0.

Render deployment remained blocked throughout: no service was created while the production tree
carried a critical advisory. Phase 8C.4 remains **open**, and nothing has been deployed.

---

## 23. Phase 8C.4F — environment-configurable Inngest try-on concurrency

**Status:** implemented. Commit `chore: make Inngest concurrency configurable`.
**Classification:** deployment-compatibility slice. No Supabase, schema, RLS, storage, auth,
rate-limit, Sentry, PostHog, CSP or Render configuration change. No paid generation occurred.

### Staging state at the start of this slice

Render staging (`dekhlo-staging.onrender.com`) is **deployed and healthy**. The earlier
`/api/health/supabase` 503 (diagnosed read-only on 2026-09-21) was an environment fault, not an
application fault: the staging `NEXT_PUBLIC_SUPABASE_URL` had been configured with a trailing
`/rest/v1/` path. Correcting it to the bare project origin resolved the probe. A Render runtime
diagnostic then proved the secret key is present with the expected prefix and length (41, unchanged
by trim), the URL host is the hosted staging project, and a direct runtime query returned HTTP 200.
No Supabase code change was required, and none was made.

### The Inngest sync blocker

Syncing `/api/inngest` to the `dekhlo-staging` Inngest environment was rejected because
`process-try-on-generation` declared a global concurrency limit of **8** while the staging account
is on the Inngest **Hobby plan, whose ceiling is 5 concurrent steps**. Upgrading the plan for a
staging environment was not warranted.

### What changed

The hard-coded global limit in `lib/inngest/functions/process-try-on-generation.ts` is now read
from **`INNGEST_TRY_ON_CONCURRENCY`** through a new accessor in `lib/inngest/env.ts`, alongside the
existing Inngest env accessors:

| `INNGEST_TRY_ON_CONCURRENCY` | Resolved global limit |
|---|---|
| absent, empty, or whitespace | **8** (the previous hard-coded value, now `DEFAULT_INNGEST_TRY_ON_CONCURRENCY`) |
| `"5"` | 5 — what staging will configure |
| any positive integer literal | that value |
| `0`, `-1`, `1.5`, `abc`, `NaN`, `Infinity`, `+5`, `1e2` | **throws at function registration** |

Invalid values deliberately do **not** fall back to 8. The accessor is evaluated at module load
inside `inngest.createFunction(...)`, so a misconfigured deployment fails when the function is
registered rather than quietly running with a concurrency nobody chose. No plan-specific maximum is
enforced in code — Inngest owns the account ceiling and rejects an over-limit sync itself. The
rejected value is never included in the error message.

The per-session limit `{ limit: 1, key: "event.data.sessionId" }` is unchanged, as are the function
id, trigger, `retries: 3`, every step id, the `onFailure` compensation path, timeouts and all OpenAI
behaviour. `cleanup-expired-try-on-artifacts` is untouched: it declares no concurrency, keeps its id
and its hourly cron, and does not reference the new variable — asserted by test, not by review.
`INNGEST_DEV` behaviour is unchanged.

### Registration proof

The registered function objects were loaded directly (no Inngest sync, no event sent):

```text
INNGEST_TRY_ON_CONCURRENCY unset  → concurrency [{limit:1,key:"event.data.sessionId"},{limit:8}]
INNGEST_TRY_ON_CONCURRENCY="5"    → concurrency [{limit:1,key:"event.data.sessionId"},{limit:5}]
INNGEST_TRY_ON_CONCURRENCY="8"    → concurrency [{limit:1,key:"event.data.sessionId"},{limit:8}]
INNGEST_TRY_ON_CONCURRENCY="0"    → registration throws: Invalid INNGEST_TRY_ON_CONCURRENCY
INNGEST_TRY_ON_CONCURRENCY="abc"  → registration throws: Invalid INNGEST_TRY_ON_CONCURRENCY
cleanup-expired-try-on-artifacts  → concurrency undefined, cron "0 * * * *" in every case
```

### Configuration guidance

`.env.example` documents the variable as optional with default 8; **staging on the Hobby plan sets
5**; production sets it according to the active Inngest plan and measured workload. The staging
value is not written into any committed or local env file.

### Files changed

`lib/inngest/env.ts` (accessor), `lib/inngest/functions/process-try-on-generation.ts` (one line:
`{ limit: 8 }` → `{ limit: getInngestTryOnConcurrency() }`), `.env.example`,
`tests/unit/phase8c4f-inngest-concurrency.test.ts` (new, 30 tests), this document.

### Regression

Unit **454 → 484** (+30) / TypeScript pass / lint 0 errors + 4 baseline warnings / build pass on
Next.js 16.3.5 / production `npm audit` **0 vulnerabilities**. Database tests were not rerun: this
slice touches no migration, schema or SQL, and no repository policy requires pgTAP for an env-only
Inngest configuration change.

### Still pending

**Inngest staging sync remains pending.** Staging must be redeployed with
`INNGEST_TRY_ON_CONCURRENCY=5` before `/api/inngest` can register within the Hobby plan ceiling.
Nothing was deployed and no sync was attempted in this slice. Phase 8C.4 remains **open**.

---

## 24. Future Phase 8C.4+ (remaining)

CSP enforcement (and the nonce work required to drop `script-src 'unsafe-inline'`), CSP observation of
the authenticated dashboard and platform surfaces, manual lead and demo limiter runtime verification,
the L1 session existence-oracle normalization, the framing policy decision tied to the
merchant-embedding model, and the COOP/CORP/COEP evaluation remain deferred until explicitly approved.

Further observability work (additional analytics events, merchant identity policy, browser Sentry review) remains deferred until explicitly approved.

Phases 8C.1, 8C.2 and 8C.3 are runtime verified and closed. Phase 8C.4 is open: slices 8C.4A and
8C.4D have landed, no hosting service has been created, and staging runtime verification —
including the `X-Forwarded-For` spoof-resistance probe for 8C.4D — has not been performed.
