# Supabase Phase 8B — Leads

Phase **8B.1** adds the `leads` table, RLS, `create_try_on_lead` RPC, and secure capture API routes. **8B.1 is closed** after remote runtime verification below. **8B.2** (public form + merchant dashboard) and **8C** are not started.

**No credentials, tokens, or private customer data belong in this document.**

## Phase 8B.1 — Database and capture API

### Migrations

| File | Purpose |
|------|---------|
| `20260728100000_phase8b_leads_schema.sql` | `leads` table, constraints, immutability triggers |
| `20260728100100_phase8b_leads_rls_grants.sql` | FORCE RLS, owner/admin SELECT only |
| `20260728100200_phase8b_create_try_on_lead_rpc.sql` | `create_try_on_lead` (service_role only) |

### Authorization

- Shoppers use the existing **httpOnly try-on session cookie** (`try_on_session_{sessionId}`), not Supabase login.
- **Missing cookie** → **401** (`Session access is required.`).
- **Invalid session id (route), unknown session, wrong token** → **404** with generic message (`This request could not be completed.`) — enumeration-resistant.
- **Valid token** + expired or soft-deleted session → **410**.
- RPC re-validates session eligibility under row lock.

### API routes

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/try-on/sessions/[sessionId]/lead` | Create lead (201) or idempotent replay (200) |
| `GET` | `/api/try-on/sessions/[sessionId]/lead` | Lead submission status only |

Not available on `/demo`.

All responses use `Cache-Control: no-store`.

#### GET response (exact fields)

```json
{ "submitted": true }
```

```json
{ "submitted": false }
```

No `leadId`, PII, metadata, or internal identifiers in GET responses.

#### POST response (exact fields)

```json
{
  "leadId": "uuid",
  "wasCreated": true
}
```

Idempotent replay uses **HTTP 200** with `"wasCreated": false`.

### POST body (strict JSON, max 4096 bytes)

- `fullName`, `email`, `phone`, `consentToContact` (must be `true`), `consentToMarketing` (optional, default false), `idempotencyKey` (UUID), `website` (honeypot, must be empty)

Server derives brand, product, source, `consented_at`, and allowlisted metadata snapshot.

### Rate limiting

Lead capture uses Upstash (same infrastructure as demo/session limits). Client IPs are hashed with **`LEAD_RATE_LIMIT_HASH_SECRET`** (server-only, never `NEXT_PUBLIC_*`, not derived from Supabase/OpenAI/Inngest/Upstash credentials).

- **Production:** missing `LEAD_RATE_LIMIT_HASH_SECRET` → fail closed (request handling throws before rate-limit key derivation).
- **Development/test:** non-production fallback secret for local runs; unit tests inject secrets explicitly where needed.

Documented in `.env.example` without sample values.

### Stable RPC error identifiers

| Identifier | HTTP |
|------------|------|
| `LEAD_SESSION_UNAVAILABLE` | 404 |
| `LEAD_SESSION_NOT_COMPLETED` | 404 |
| `LEAD_SESSION_EXPIRED` | 410 |
| `LEAD_CONFLICT` | 409 |
| `LEAD_CONSENT_REQUIRED` | 422 |
| `LEAD_INVALID_INPUT` | 422 |

### Merchant access (RLS)

| Role | SELECT leads |
|------|----------------|
| owner | yes |
| admin | yes |
| editor | no |
| analyst | no |

`platform_admin` does not bypass merchant RLS without owner/admin brand membership.

### Database grants (summary)

| Client | leads table | `create_try_on_lead` |
|--------|-------------|----------------------|
| anon | no access | no EXECUTE |
| authenticated | SELECT via owner/admin RLS only | no EXECUTE |
| service_role | ALL (server/RPC) | EXECUTE |

Leads are immutable (`UPDATE`/`DELETE` rejected).

### PII retention (product note)

Provisional recommendation: **24 months** from `created_at`, subject to legal review. **No automatic deletion cron in 8B.1.**

### Local verification

```bash
npx supabase db reset --local
npx supabase test db --local
npm run test:unit
npx tsc --noEmit
npm run lint
npm run build
```

pgTAP: `018_phase8b_leads_schema.test.sql`, `019_phase8b_leads_rls.test.sql`.

### Deployment

1. Apply the three Phase 8B.1 migrations to the linked Supabase project (`supabase db push` or CI).
2. Set **`LEAD_RATE_LIMIT_HASH_SECRET`** in each runtime environment (server-only; never commit).
3. Deploy the application build that includes the capture API routes.
4. Run automated verification locally (below) before and after deploy; record manual API checks per the runtime checklist.

---

## Phase 8B.1 runtime verification (manual)

Recorded after linked Supabase project deployment and application smoke tests against a disposable completed try-on session on Test Brand. No real identifiers, PII, tokens, or secret values appear in this section.

### Remote deployment verification (passed)

| Check | Result |
|-------|--------|
| All three Phase 8B.1 migrations applied successfully to the linked project | Pass |
| `LEAD_RATE_LIMIT_HASH_SECRET` configured locally as a server-only secret | Pass |
| Secret remained outside Git | Pass |
| Disposable completed try-on session used for API checks | Pass |
| Session status was `completed` | Pass |
| `result_storage_path` populated | Pass |
| `completed_at` populated | Pass |
| `deleted_at` was null before expiry | Pass |
| `expires_at` initially in the future | Pass |

### Lead creation verification (passed)

| Check | Result |
|-------|--------|
| First POST returned HTTP 201 | Pass |
| First POST returned `wasCreated` true | Pass |
| POST response contained only `leadId` and `wasCreated` | Pass |
| POST did not expose email, phone, full name, brand/product IDs, metadata, tokens, or storage paths | Pass |
| Email stored normalized (lowercase) | Pass |
| Phone stored normalized | Pass |
| `consent_to_contact` true | Pass |
| `consent_to_marketing` false | Pass |
| `source` was `try_on_result` | Pass |
| Metadata contained only approved snapshot fields (`brand_name`, `brand_slug`, `product_name`, `product_slug`) | Pass |
| Exactly one lead row created | Pass |

### GET contract verification (passed)

| Check | Result |
|-------|--------|
| Authenticated GET returned HTTP 200 | Pass |
| GET response contained exactly `submitted` | Pass |
| GET returned `submitted` true after creation | Pass |
| GET did not return `leadId` | Pass |
| GET did not expose PII or internal identifiers | Pass |
| GET used `Cache-Control: no-store` | Pass |

### Idempotency verification (passed)

| Check | Result |
|-------|--------|
| Identical replay returned HTTP 200 | Pass |
| Identical replay returned `wasCreated` false | Pass |
| Replay returned the same existing lead (no second row) | Pass |
| No duplicate lead row created | Pass |
| Changed PII with the same idempotency key returned HTTP 409 | Pass |
| Conflict response was sanitized | Pass |
| Conflict did not overwrite the existing lead | Pass |

### Authorization verification (passed)

| Check | Result |
|-------|--------|
| Request with session credentials omitted returned HTTP 401 | Pass |
| curl without cookies returned HTTP 401 | Pass |
| Earlier Incognito HTTP 200 explained by a retained session cookie (not anonymous access) | Pass |
| Invalid session/token responses enumeration-resistant | Pass |
| Valid token with expired session returned HTTP 410 | Pass |
| Existing lead row remained after session expiry | Pass |

### RLS verification (passed)

| Check | Result |
|-------|--------|
| Authenticated Test Brand owner could SELECT the Test Brand lead via RLS | Pass |
| Owner saw exactly the expected own-brand lead | Pass |
| Cross-brand lead rows remained hidden | Pass |
| Platform role alone does not bypass merchant lead RLS | Pass (pgTAP) |
| Editor access denied | Pass (pgTAP) |
| Analyst access denied | Pass (pgTAP) |
| Anon direct access denied | Pass (pgTAP) |
| Authenticated direct INSERT denied | Pass (pgTAP) |

### No-side-effect verification (passed)

| Check | Result |
|-------|--------|
| Lead creation added no additional credit transaction | Pass |
| Successful try-on retained only normal reserve and consume lifecycle | Pass |
| No release transaction introduced by lead capture | Pass |
| Session status unchanged by lead submission | Pass |
| `expires_at` unchanged during lead submission | Pass |
| `consent_to_store` unchanged | Pass |
| `completed_at` unchanged | Pass |
| No OpenAI request triggered | Pass |
| No Inngest generation event triggered | Pass |
| No storage upload or deletion triggered | Pass |
| No second credit consumed | Pass |

### Automated regression (after doc-only changes)

```bash
npx supabase db reset --local
npx supabase test db --local
npm run test:unit
npx tsc --noEmit
npm run lint
npm run build
npm audit --omit=dev --registry=https://registry.npmjs.org/
```

Expected: **≥ 360** pgTAP tests, **≥ 130** unit tests, clean TypeScript, lint (acknowledged warnings only), production build on Next.js **16.2.11**, **0** production npm audit vulnerabilities.

## Out of scope (8B.1)

- Public lead form UI
- `/dashboard/leads`
- Email/CRM/export
- Phase 8C observability
