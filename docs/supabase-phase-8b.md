# Supabase Phase 8B — Leads

Phase **8B.1** adds the `leads` table, RLS, `create_try_on_lead` RPC, and secure capture API routes. **8B.2** (public form + merchant dashboard) and **8C** are not started.

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

1. Apply migrations locally and run pgTAP.
2. **Do not push to remote until approved.**
3. Set **`LEAD_RATE_LIMIT_HASH_SECRET`** in production before enabling lead capture traffic.

## Out of scope (8B.1)

- Public lead form UI
- `/dashboard/leads`
- Email/CRM/export
- Phase 8C observability
