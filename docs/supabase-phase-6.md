# Supabase Phase 6 — Try-On Sessions and Session-Linked Credit Lifecycle

Phase 6 adds secure merchant try-on sessions, private customer media buckets, session-linked credit reserve/consume/release RPCs, synchronous generation, the public product try-on route, and a rate-limited `/demo` relocation. Inngest, cron retention deletion, platform admin, and billing remain deferred.

## Supabase CLI

- **Package:** `supabase@2.109.1`
- **Invocation:** `npx supabase …`

## Local setup

```bash
npx supabase start
npx supabase db reset --local
npx supabase test db --local
npx supabase db lint --local --schema public --fail-on error
npm run test:unit
```

Regenerate types after schema changes:

```bash
node -e "const {spawnSync}=require('child_process');const fs=require('fs');const r=spawnSync('npx',['supabase','gen','types','typescript','--local','--schema','public'],{encoding:'buffer',shell:true});if(r.status)process.exit(r.status);fs.writeFileSync('lib/supabase/database.types.ts',r.stdout);"
```

## Migrations

| File | Purpose |
|------|---------|
| `20260723150000_phase6_try_on_sessions_schema.sql` | Sessions table, enum, constraints, immutability trigger, `session_id` on credits, merchant-safe view |
| `20260723150100_phase6_try_on_rls_grants.sql` | Session RLS, column grants excluding `anonymous_token_hash` |
| `20260723150200_phase6_credit_lifecycle_rpcs.sql` | `queue_try_on_session`, `consume_reserved_brand_credits`, `release_reserved_brand_credits` |
| `20260723150300_phase6_private_storage_buckets.sql` | Private `customer-uploads` and `try-on-results` buckets |

Do **not** edit Phase 1–5 migration files.

## Fixed V1 credit policy

- **Cost:** exactly **1 credit** per successfully queued merchant try-on
- **Source of truth:** `public.try_on_v1_credit_cost()` returns `1`
- Never accepted from browser/API clients
- Stored immutably in `try_on_sessions.credit_cost` at queue time
- Consume/release always use stored value
- Demo routes do **not** use merchant credits or `try_on_sessions`

## `public.try_on_sessions`

| Column | Notes |
|--------|-------|
| `id` | UUID PK |
| `brand_id`, `product_id` | Composite FK → `products(brand_id, id)` |
| `status` | `try_on_session_status` enum |
| `credit_cost` | Nullable until queue; fixed to `1` after queue |
| `person_storage_path`, `result_storage_path` | Relative private paths only |
| `upload_validated_at` | Set after server validation |
| `consent_to_store` | Default `false` |
| `expires_at` | Retention metadata (24h default; 30d with consent after completion) |
| `client_request_id` | Unique UUID string for idempotent create |
| `anonymous_token_hash` | SHA-256 hex; never exposed to merchants |
| `error_code`, `sanitized_error_message` | Merchant-safe errors only |

### Status enum

`pending_upload`, `queued`, `processing`, `completed`, `failed`, `cancelled`

### Status / credit_cost matrix

| Status | credit_cost |
|--------|-------------|
| `pending_upload` | null or 0 |
| `queued`, `processing`, `completed` | > 0 (exactly 1 after queue) |
| `failed`, `cancelled` | null/0 if never queued; > 0 if previously reserved |

## Credit RPCs (service_role only)

| RPC | Idempotency key | Effect |
|-----|-----------------|--------|
| `queue_try_on_session(p_session_id)` | `session:{id}:reserve` | Reserve 1, set `credit_cost=1`, status → `queued` |
| `consume_reserved_brand_credits(p_session_id)` | `session:{id}:consume` | Move reserved → consumed, status → `completed` |
| `release_reserved_brand_credits(p_session_id)` | `session:{id}:release` | Release reserved, status → `failed` (preserve `cancelled`) |

All three: SECURITY DEFINER, `search_path = ''`, revoked from PUBLIC/anon/authenticated.

## Anonymous session token design

- 256-bit random token in HttpOnly cookie (`try_on_session_{sessionId}`)
- Database stores SHA-256 hex only
- Timing-safe hash comparison
- Session UUID alone is insufficient for access
- Tokens never appear in URLs or API responses

## Private Storage

| Bucket | Visibility | Limit | Paths |
|--------|------------|-------|-------|
| `customer-uploads` | private | 8 MB | `{brand_id}/{session_id}/person.{ext}` |
| `try-on-results` | private | 10 MB | `{brand_id}/{session_id}/result.png` |

Signed URL TTL: **15 minutes**. No broad anon/authenticated Storage policies.

## API routes

| Route | Purpose |
|-------|---------|
| `POST /api/try-on/sessions` | Create session, signed upload URL, set token cookie |
| `POST /api/try-on/sessions/[id]/validate-upload` | Validate person photo, queue session |
| `POST /api/try-on/sessions/[id]/generate` | Synchronous generation + consume |
| `GET /api/try-on/sessions/[id]` | Safe status/result polling |
| `POST /api/demo/try-on` | Rate-limited demo (two-image) |
| `POST /api/try-on` | Same protected demo handler (legacy alias) |

Public responses never include storage paths, token hashes, or raw provider errors.

## Application routes

| Route | Purpose |
|-------|---------|
| `/try/[brandSlug]/[productSlug]` | Merchant product try-on (person photo only) |
| `/demo` | Relocated legacy `TryOnStudio` |
| `/` | Marketing landing with CTA to `/demo` |

## AI extraction (unchanged behavior)

Generation extracted to:

- `lib/try-on/generate.ts`
- `lib/try-on/config.ts`
- `lib/try-on/prompt.ts`
- `lib/try-on/extract-image.ts`

Model, prompt, quality, vision detail, tool config, and output format are unchanged from the pre-Phase-6 demo route.

## Upstash / demo controls

Server-only env vars (documented in `.env.example`):

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `DEMO_KILL_SWITCH`
- `DEMO_DAILY_CAP`

Production routes fail closed if rate-limit infrastructure is unavailable. Development uses an in-memory limiter with a server warning.

## Database tests

| File | Assertions |
|------|------------|
| `012_try_on_sessions_schema.test.sql` | 22 |

Full suite: **244** pgTAP tests. Unit tests: `npm run test:unit` (5 assertions).

## Remote deployment

```bash
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
npx supabase db lint --linked --schema public --fail-on error
```

Do **not** run `db reset` against the linked project.

## Deferred

| Phase | Feature |
|-------|---------|
| 7 | Inngest async generation, cron retention deletion, email |
| 8 | Platform admin, audit logs, admin grant/revoke |

## Manual verification checklist

1. Confirm Test Brand has 5 available credits.
2. Confirm it has one active product.
3. Open `/try/[brandSlug]/[productSlug]`.
4. Confirm only a person photo is requested.
5. Upload a valid image.
6. Confirm `pending_upload` is created without a reservation.
7. Confirm validation queues the session and reserves 1 credit.
8. Confirm generation completes.
9. Confirm the result is in private `try-on-results`.
10. Confirm `customer-uploads` is private.
11. Confirm public APIs never expose raw Storage paths.
12. Confirm signed result URL works and expires.
13. Confirm balance: granted 5, reserved 0, consumed 1, available 4 after completion.
14. Confirm reserve/consume transactions share `session_id`.
15. Confirm idempotent retries do not double-consume.
16. Confirm invalid session token cannot access status/result.
17. Confirm `/demo` accepts both person and garment images.
18. Confirm `/demo` does not consume merchant credits.
19. Confirm demo kill switch works.
20. Confirm homepage links to `/demo` and no unlimited API remains.

## Security reminders

No credentials, tokens, or service role keys belong in this document or committed env files.
