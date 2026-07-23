# Supabase Phase 5 — Credit Balance and Transaction Foundation

Phase 5 adds merchant credit balances (`public.brand_credit_balances`), an append-only credit ledger (`public.credit_transactions`), a trusted `grant_brand_credits` RPC (service role only), RLS for finance-role reads, and a read-only dashboard page at `/dashboard/credits`. Try-on sessions, reservations, billing, platform-admin operations, and merchant grant UI remain deferred.

## Supabase CLI

- **Package:** `supabase@2.109.1` (devDependency)
- **Invocation:** `npx supabase …`
- **Local Postgres:** Docker required (`npx supabase start`)

## Local setup

```bash
npx supabase start
npx supabase db reset --local
npx supabase test db --local
npx supabase db lint --local --schema public --fail-on error
```

Regenerate TypeScript types after schema changes:

```bash
node -e "const {spawnSync}=require('child_process');const fs=require('fs');const r=spawnSync('npx',['supabase','gen','types','typescript','--local','--schema','public'],{encoding:'buffer',shell:true});if(r.status)process.exit(r.status);fs.writeFileSync('lib/supabase/database.types.ts',r.stdout);"
```

On Windows, use the Node invocation above to avoid PowerShell redirect encoding issues (see Phase 2 docs).

## Migrations

| File | Purpose |
|------|---------|
| `20260723140000_phase5_credit_schema.sql` | Enum, balance and transaction tables, constraints, indexes, append-only triggers, brand balance initialization trigger, backfill |
| `20260723140100_phase5_credit_rls_grants.sql` | Table grants and SELECT-only RLS policies |
| `20260723140200_phase5_grant_brand_credits.sql` | Trusted idempotent `grant_brand_credits` RPC |

Do **not** edit Phase 2–4 migration files.

## `public.brand_credit_balances` schema

| Column | Type | Notes |
|--------|------|-------|
| `brand_id` | `uuid` PK | FK → `brands.id` ON DELETE CASCADE |
| `granted_credits` | `integer NOT NULL DEFAULT 0` | Non-negative |
| `reserved_credits` | `integer NOT NULL DEFAULT 0` | Non-negative |
| `consumed_credits` | `integer NOT NULL DEFAULT 0` | Non-negative |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Via `set_updated_at()` trigger |

### Constraints

- `brand_credit_balances_granted_non_negative_chk` — `granted_credits >= 0`
- `brand_credit_balances_reserved_non_negative_chk` — `reserved_credits >= 0`
- `brand_credit_balances_consumed_non_negative_chk` — `consumed_credits >= 0`
- `brand_credit_balances_available_non_negative_chk` — `granted_credits >= reserved_credits + consumed_credits`

**Available credits are never stored.** They are always derived:

```
available = granted_credits - reserved_credits - consumed_credits
```

No `credits_balance` column was added to `public.brands`.

### Indexes

Primary key on `brand_id` is sufficient for balance lookups.

## `public.credit_transactions` schema (append-only)

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `brand_id` | `uuid NOT NULL` | FK → `brands.id` ON DELETE CASCADE |
| `type` | `credit_transaction_type NOT NULL` | See enum below |
| `amount` | `integer NOT NULL` | Must be `> 0`; direction from type |
| `idempotency_key` | `text NOT NULL` | Unique, non-empty, max 128 chars |
| `metadata` | `jsonb NOT NULL DEFAULT '{}'` | Must be a JSON object |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

**No `session_id` column in Phase 5** (added in Phase 6 with `try_on_sessions`).

### Constraints and indexes

- `credit_transactions_amount_positive_chk` — `amount > 0`
- `credit_transactions_idempotency_key_not_empty_chk`
- `credit_transactions_idempotency_key_length_chk` — `char_length <= 128`
- `credit_transactions_metadata_object_chk` — `jsonb_typeof(metadata) = 'object'`
- `credit_transactions_idempotency_key_key` — unique on `idempotency_key`
- `credit_transactions_brand_id_idx` — brand transaction history
- `credit_transactions_brand_created_at_idx` — `(brand_id, created_at DESC)`

### Append-only enforcement

- `credit_transactions_prevent_update` and `credit_transactions_prevent_delete` triggers raise `42501` on UPDATE/DELETE.
- `authenticated` has **SELECT only** on both credit tables — no INSERT/UPDATE/DELETE grants.
- `anon` has **no** table privileges.
- `service_role` has ALL for trusted infrastructure RPCs.
- Database-owner recovery (manual DELETE/UPDATE as superuser) is possible for incident response but is not exposed to application code.

## `credit_transaction_type` enum

Phase 5 creates the full lifecycle enum with only **grant** transactions written in this phase:

| Value | Phase 5 usage | Counter effect (when used) |
|-------|---------------|----------------------------|
| `grant` | **Yes** — via `grant_brand_credits` | `granted += amount` |
| `reserve` | Enum only (Phase 6) | `reserved += amount` |
| `consume` | Enum only (Phase 6) | `reserved -= amount`, `consumed += amount` |
| `release` | Enum only (Phase 6) | `reserved -= amount` |

**Not present:** `admin_grant`, `admin_revoke` (Phase 8+).

## Balance initialization and backfill

1. **Migration backfill** — `INSERT INTO brand_credit_balances (brand_id) SELECT id FROM brands ON CONFLICT DO NOTHING` creates zero balances for all existing brands.
2. **Future brands** — `brands_initialize_credit_balance` trigger (AFTER INSERT on `public.brands`) calls `initialize_brand_credit_balance()` with `ON CONFLICT DO NOTHING`.
3. **Idempotent** — duplicate initialization never creates a second row or fails brand onboarding.
4. **No automatic trial credits** — all new balances start at zero unless granted via trusted infrastructure.

Phase 3 `create_brand_with_owner` migration was **not** modified.

## Table grants

| Role | `brand_credit_balances` | `credit_transactions` |
|------|-------------------------|---------------------|
| `anon` | none | none |
| `authenticated` | SELECT | SELECT |
| `service_role` | ALL | ALL |

No merchant write grants. No broad PUBLIC write access.

## RLS role matrix

Separate **SELECT-only** policies (no `FOR ALL` policies):

| Role | Read balance | Read transactions |
|------|:------------:|:-----------------:|
| owner | yes | yes |
| admin | yes | yes |
| analyst | yes | yes |
| editor | no | no |
| unrelated authenticated | no | no |
| anon | no (no grant) | no (no grant) |

Policies use `public.user_has_brand_role(brand_id, ARRAY['owner','admin','analyst'])`.

## `grant_brand_credits` RPC

```sql
public.grant_brand_credits(
  p_brand_id uuid,
  p_amount integer,
  p_idempotency_key text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  transaction_id uuid,
  brand_id uuid,
  granted_credits integer,
  reserved_credits integer,
  consumed_credits integer,
  available_credits integer,
  was_created boolean
)
```

### Execution permissions

| Role | EXECUTE |
|------|:-------:|
| PUBLIC | no |
| anon | no |
| authenticated | no |
| service_role | **yes** |

This RPC is **not** a merchant self-service or platform-admin grant function. It is for trusted onboarding, purchase webhooks, and internal server scripts using the service role. Merchants cannot call it from the browser or dashboard.

### Validation

- Brand must exist
- `p_amount` must be a positive integer
- `p_idempotency_key` must be non-empty and ≤ 128 characters
- `p_metadata` must be a JSON object (defaults to `{}`)
- Always creates a `grant` transaction — no caller-supplied type or counter values

### Idempotency and atomicity

1. Advisory transaction lock on `hashtext('grant_brand_credits:' || p_idempotency_key)`
2. If idempotency key exists with matching brand, type (`grant`), and amount → return prior result (`was_created = false`), no counter change
3. If key exists with conflicting brand, type, or amount → `23505 Idempotency key conflict`
4. Lock balance row (`FOR UPDATE`), increment `granted_credits`, insert transaction
5. Unique violation on concurrent insert → re-check idempotency and return prior result or conflict
6. Any error rolls back both counter update and transaction insert

### Why authenticated cannot execute

Granting credits is a **trusted infrastructure** operation. Allowing authenticated merchants (including owners) to call this RPC would enable self-granting credits from compromised client code. Phase 8 will add separate platform-admin grant/revoke RPCs with audit logging; Phase 5 intentionally keeps grant access on `service_role` only.

## Dashboard credit read design

**Chosen approach:** direct RLS-scoped queries via the authenticated Supabase server client.

- `/dashboard/credits` selects from `brand_credit_balances` and `credit_transactions` filtered by the session's current `brand_id`.
- RLS enforces tenant isolation and role checks at the database layer.
- `availableCredits` is computed server-side in `lib/credits/balance.ts` — never read from a stored column.
- No SECURITY DEFINER view (which could bypass tenant RLS).
- Editors see an explicit "Access unavailable" UI state; RLS returns zero rows for credit data.
- Navigation hides Credits for editors (`canViewCredits()`), but RLS remains the enforcement boundary.

## Application files

| Path | Purpose |
|------|---------|
| `lib/credits/permissions.ts` | `canViewCredits()` for owner/admin/analyst |
| `lib/credits/balance.ts` | `calculateAvailableCredits()`, `toCreditBalanceSnapshot()` |
| `app/dashboard/credits/page.tsx` | Read-only credit dashboard |
| `components/dashboard/dashboard-shell.tsx` | Credits nav item (finance roles only) |

No public credit API, no merchant Server Action for granting, no admin client in client components, no application wrapper for `grant_brand_credits` in Phase 5.

## Database tests

| File | Assertions |
|------|------------|
| `009_credit_schema.test.sql` | 27 |
| `010_credit_grant_rpc.test.sql` | 18 |
| `011_credit_rls.test.sql` | 13 |

**Total Phase 5:** 58 assertions. Full suite: **222 tests**.

Coverage includes schema, constraints, enum values, balance initialization, grant RPC permissions and idempotency, RLS role matrix, append-only behavior, and direct-write denial.

## Remote deployment

```bash
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
npx supabase db lint --linked --schema public --fail-on error
```

Phase 5 dry-run queued only:

- `20260723140000_phase5_credit_schema.sql`
- `20260723140100_phase5_credit_rls_grants.sql`
- `20260723140200_phase5_grant_brand_credits.sql`

Local and remote migration histories match after push.

Compare linked types to committed local types:

```bash
node -e "const {spawnSync}=require('child_process');const fs=require('fs');const r=spawnSync('npx',['supabase','gen','types','typescript','--linked','--schema','public'],{encoding:'buffer',shell:true});if(r.status)process.exit(r.status);fs.writeFileSync('supabase/.temp/database.types.remote.ts',r.stdout);"
```

Do **not** run `db reset` against the linked project.

## Remote verification (completed)

- Both credit tables exist
- 1 remote brand → 1 balance row (parity confirmed)
- `session_id` absent from `credit_transactions`
- Enum values: `grant`, `reserve`, `consume`, `release` only
- `try_on_sessions` does not exist
- `authenticated` cannot execute `grant_brand_credits`; `service_role` can
- Linked `public` schema types match `lib/supabase/database.types.ts`

## Safe test grant procedure

For remote verification only, on disposable **Test Brand** (`test-brand`):

```sql
SELECT * FROM public.grant_brand_credits(
  '<brand_id>'::uuid,
  5,
  'phase5-remote-verification-grant',
  jsonb_build_object('phase', '5', 'purpose', 'remote-verification')
);
```

**Result:** one grant transaction, `granted_credits = 5`, `available_credits = 5`. Idempotent retry left `tx_count = 1`.

**Retained or reversed:** **Retained** on Test Brand. Phase 5 has no revoke operation; the 5-credit test grant remains on the disposable test brand for dashboard verification.

## Generated type changes

`lib/supabase/database.types.ts` gains:

- `brand_credit_balances` table
- `credit_transactions` table
- `credit_transaction_type` enum
- `grant_brand_credits` function

Does **not** include: `try_on_sessions`, transaction `session_id`, `admin_grant_brand_credits`, `admin_revoke_brand_credits`.

Do not hand-edit generated rows.

## Security review

- No authenticated user can call `grant_brand_credits`
- No owner can self-grant credits from the browser
- No credit mutation from client components
- No mutable balance stored on `brands`
- Available credits derived, never stored
- Transactions append-only with trigger enforcement
- Idempotent retries do not double-grant
- Conflicting idempotency keys fail safely
- Counters remain non-negative; available cannot go negative via CHECK
- No `session_id`, admin transaction types, or `platform_role`
- No service role key in client bundles
- Cross-tenant credit reads blocked by RLS
- Editors cannot read credit data

## Rollback strategy

1. Revert application deploy (remove `/dashboard/credits` and credit libs)
2. Drop Phase 5 objects in reverse order if no production credit data must be preserved:
   - `grant_brand_credits` function
   - RLS policies and revoke grants
   - `credit_transactions`, `brand_credit_balances`, `credit_transaction_type`
3. Do not modify already-applied Phase 2–4 migrations

## Deferred to later phases

| Phase | Feature |
|-------|---------|
| 6 | `try_on_sessions`, `credit_transactions.session_id`, `queue_try_on_session`, reserve/consume/release RPC usage, try-on routes |
| 8 | `admin_grant_brand_credits`, `admin_revoke_brand_credits`, `audit_logs`, `platform_role`, platform-admin UI |
| — | Billing, Stripe, credit purchases, merchant grant buttons, Inngest workers |

## Manual verification checklist

1. Log in as brand owner/admin/analyst → `/dashboard/credits` shows balance counters and transactions
2. Log in as editor → Credits nav hidden; direct URL shows access unavailable; no credit values
3. Unauthenticated `/dashboard/credits` redirects to login
4. Product catalog CRUD and image upload/replace/delete still work
5. Homepage (`GET /`) returns 200; empty `POST /api/try-on` returns 400

## Security reminders

No credentials, tokens, or service role keys belong in this document or committed env files.
