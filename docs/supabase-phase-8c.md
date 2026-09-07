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

Phase 8C.3 as a whole is **not closed**. Runtime verification for 8C.3A is **pending**.

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

### Runtime verification — PENDING

Phase 8C.3A is **not** runtime verified. The following still require manual runtime checks:

- oversized session-create JSON returns `400` without parsing
- ordinary try-on session creation, upload validation, generation and polling remain unaffected
- oversized demo multipart returns `413`
- a normal two-image demo submission still succeeds
- malformed session ids return `404` on all three routes
- session restoration and polling behave unchanged

**Phase 8C.3 is not closed.** Slices 8C.3B (rate-limit fail-closed policy) and 8C.3C (security
headers and CSP) have not been started.

---

## 17. Phase 8C.3B — fail-closed rate-limit infrastructure

Second Phase 8C.3 slice. Addresses preflight findings **H1** (Upstash timeout failed open), **M4**
(lead limiter failures surfaced as 500) and **M1** (platform credit mutations had no application
limiter). Security headers and CSP remain out of scope.

Phase 8C.3 as a whole is **not closed**. Runtime verification for 8C.3B is **pending**.

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

### Trusted-proxy assumption

`getClientIp` header-selection logic is **unchanged** in this slice. Its safety depends on the
production reverse proxy overwriting or sanitizing `X-Forwarded-For`. A documented note now sits at
the function: not all proxies behave this way — one that appends instead would let a client prepend
an arbitrary value and rotate IP-scoped buckets — so if the deployment moves away from that proxy
model, the header trust policy must be reviewed. No hop-count logic was implemented, as that would
require deployment evidence.

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

### Runtime verification — PENDING

Phase 8C.3B is **not** runtime verified. Still to confirm manually:

- normal lead, session-create and demo traffic unaffected while Upstash is healthy
- a real limit breach still returns 429 on each surface
- an induced Upstash outage or timeout returns 503, and no lead row, session row, credit
  reservation, or demo generation occurs
- platform grant/revoke succeed normally under the 30/min budget
- the 31st mutation attempt within a minute returns 429 with no credit or audit mutation
- grant and revoke visibly share one actor budget
- production startup with rate-limit configuration absent fails closed rather than allowing traffic

**Phase 8C.3 is not closed.** Slice 8C.3C (security headers and CSP) has not been started.

---

## 18. Phase 8C.3C — browser security headers and CSP Report-Only

Third Phase 8C.3 slice. Addresses the preflight security-header finding. **No CSP is enforced**: the
purpose of this slice is to observe real application requirements before enforcement.

Phase 8C.3 as a whole is **not closed**. Runtime verification for 8C.3C is **pending**.

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

### Manual CSP verification checklist — PENDING

Load each surface with the DevTools console open, record every CSP violation, and confirm the page
still works (Report-Only must never block). Also confirm the response headers on each navigation.

| Surface | Check |
|---|---|
| Homepage `/` | Renders, fonts and styles load, no unexpected violation |
| Auth `/auth` login and signup | Forms submit (`form-action 'self'`), Supabase auth request succeeds |
| Merchant try-on `/try/<brand>/<product>` | Product image loads from the Supabase origin |
| Upload preview | `blob:` preview renders after selecting a person photo |
| Completed result | Generated result image renders (signed Supabase URL, and `data:` on the demo flow) |
| Lead form | Renders and submits successfully |
| Dashboard `/dashboard` | Loads, styles intact, Supabase session refresh succeeds |
| Dashboard leads `/dashboard/leads` | Leads load and render |
| Platform admin | Loads; credit grant/revoke submit successfully |
| PostHog ingestion | With consent accepted, `connect-src` permits `us.i.posthog.com`; no violation and no remote script load attempt |
| Supabase image/storage | Product images and signed result URLs load with no `img-src` violation |

Also confirm at the header level:

- `Strict-Transport-Security` present in a production deployment and **absent** on localhost
- `Content-Security-Policy-Report-Only` present and enforcing `Content-Security-Policy` absent
- no `X-Frame-Options`, no `frame-ancestors`, no COOP/CORP/COEP
- `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` present on both page and API
  responses

Enforcement is a later decision: only after the observation window shows a clean or well-understood
violation set should `Content-Security-Policy` be considered, most likely alongside nonce-based
script tagging to drop `'unsafe-inline'`.

**Phase 8C.3 is not closed.**

---

## 19. Future Phase 8C.4+ (not started)

CSP enforcement, the L1 session existence-oracle normalization, the framing policy decision tied to
the merchant-embedding model, and the COOP/CORP/COEP evaluation remain deferred until explicitly
approved.

Further observability work (additional analytics events, merchant identity policy, browser Sentry review) remains deferred until explicitly approved.

Phase 8C.1 and Phase 8C.2 are both runtime verified and closed.
