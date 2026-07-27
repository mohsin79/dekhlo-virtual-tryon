# Supabase Phase 8A.1 — Platform administration database security foundation

Phase 8A.1 adds the database layer for platform administration: `platform_role`, append-only `audit_logs`, extended credit transaction types, and `admin_grant_brand_credits` / `admin_revoke_brand_credits` RPCs. **No platform UI, API routes, leads, Sentry, or PostHog** in this slice.

**No credentials, tokens, or private user data belong in this document.**

## Migrations (forward-only)

| File | Purpose |
|------|---------|
| `20260727100000_phase8a_platform_role.sql` | `platform_role` enum, `profiles.platform_role`, escalation trigger |
| `20260727100100_phase8a_is_platform_admin.sql` | `is_platform_admin(uuid)` helper |
| `20260727100200_phase8a_audit_logs.sql` | `audit_logs` table, immutability, RLS |
| `20260727100300_phase8a_credit_transaction_admin_types.sql` | Enum values `admin_grant`, `admin_revoke` |
| `20260727100400_phase8a_admin_credit_rpcs.sql` | Session CHECK update + admin credit RPCs |

Do **not** edit Phase 2–7 migrations.

## Schema additions

### `public.platform_role`

- Enum value: `platform_admin`
- Column: `profiles.platform_role` (nullable)

Merchant `brand_members.role` (`owner`, `admin`, `editor`, `analyst`) is **independent**. Brand admin is **not** platform admin.

### Escalation protection

- Trigger `profiles_enforce_platform_role_change` on `INSERT`/`UPDATE` of `platform_role`
- Trusted contexts only: `CURRENT_USER` / session role `service_role`, `postgres`, `supabase_admin`, or `app.allow_platform_role_change = on`
- Authenticated users **cannot** assign, change, or clear `platform_role` on any profile (including their own)

### `public.is_platform_admin(p_user_id uuid default auth.uid())`

- `SECURITY DEFINER`, `STABLE`, empty `search_path`
- Returns `false` for null, unknown users, or non-`platform_admin` profiles
- **EXECUTE:** `authenticated`, `service_role` — not `anon`

### `public.audit_logs`

Append-only audit trail. Actions used in 8A.1:

- `credit.admin_grant`
- `credit.admin_revoke`

**RLS (Phase 8A):** platform administrators only (`is_platform_admin(auth.uid())` for SELECT). No brand-member access. No direct authenticated INSERT/UPDATE/DELETE (mutations via SECURITY DEFINER RPCs as `service_role`).

**Immutability:** `BEFORE UPDATE` / `BEFORE DELETE` → SQLSTATE `42501`.

### Credit types

`credit_transaction_type` extended with:

- `admin_grant`
- `admin_revoke`

Constraint `credit_transactions_non_session_types_no_session_chk`:

- `grant`, `admin_grant`, `admin_revoke` → `session_id IS NULL`
- `reserve`, `consume`, `release` → `session_id IS NOT NULL` (unchanged)

## RPC signatures

```sql
public.admin_grant_brand_credits(
  p_brand_id uuid,
  p_amount integer,
  p_idempotency_key text,
  p_reason text,
  p_actor uuid
)
RETURNS TABLE (
  transaction_id uuid,
  audit_log_id uuid,
  brand_id uuid,
  granted_credits integer,
  reserved_credits integer,
  consumed_credits integer,
  available_credits integer,
  was_created boolean
);

public.admin_revoke_brand_credits(
  p_brand_id uuid,
  p_amount integer,
  p_idempotency_key text,
  p_reason text,
  p_actor uuid
)
RETURNS TABLE ( /* same columns */ );
```

## Authorization model

1. **Caller:** only `service_role` may `EXECUTE` admin RPCs (same pattern as `grant_brand_credits`).
2. **`p_actor`:** required; must exist in `profiles` with `platform_role = platform_admin`. Phase 8A.2 server routes must set `p_actor` from the authenticated session user id — never from the browser.
3. RPCs **re-verify** platform admin status independently of application code.
4. There is **no** public RPC to assign `platform_role`.

## EXECUTE permissions

| Function | PUBLIC | anon | authenticated | service_role |
|----------|--------|------|---------------|--------------|
| `admin_grant_brand_credits` | no | no | no | **yes** |
| `admin_revoke_brand_credits` | no | no | no | **yes** |
| `grant_brand_credits` | unchanged | no | no | yes |
| `is_platform_admin` | no | no | yes | yes |

## Idempotency

- Shared `idempotency_key` on `credit_transactions` and `audit_logs` (unique on both tables).
- Identical replay (brand, type, amount, actor, reason) → same ids, `was_created = false`, no balance change.
- Mismatch on an existing key → `23505 Idempotency key conflict`, no mutation.
- Advisory transaction locks per RPC name + key.

## Atomicity

Each successful admin operation in one transaction:

1. Lock balance row (`FOR UPDATE`)
2. Update `brand_credit_balances.granted_credits`
3. Insert `credit_transactions` (`admin_grant` / `admin_revoke`)
4. Insert paired `audit_logs` row (`target_type = credit_transaction`, `target_id = transaction id`)

Failure rolls back all steps.

## Admin revoke balance rule

Revoke allowed only when:

```text
granted_credits - amount >= reserved_credits + consumed_credits
```

So reserved and consumed credits cannot be invalidated by revoke.

## Bootstrap: first platform administrator

There is **no** self-service promotion. After deploy, using a **trusted service-role context only** (Supabase SQL editor with service role, local CLI, or server script with `SUPABASE_SECRET_KEY`):

```sql
-- Replace with the operator auth.users / profiles id
UPDATE public.profiles
SET platform_role = 'platform_admin'::public.platform_role
WHERE id = '<operator-profile-uuid>';
```

This runs as a trusted role and passes `enforce_platform_role_change_policy`.

Optional for maintenance scripts:

```sql
SELECT set_config('app.allow_platform_role_change', 'on', true);
-- UPDATE profiles ... (same session only)
```

Do not expose this to browser clients.

## Credit transaction metadata (admin ops)

```json
{
  "actor_user_id": "<uuid>",
  "reason": "<trimmed reason>",
  "operation": "admin_grant" | "admin_revoke"
}
```

No secrets or session tokens.

## Local verification

```bash
npx supabase db reset --local
npx supabase test db --local
npm run test:unit
npx tsc --noEmit
npm run lint
npm run build
npm audit --omit=dev --registry=https://registry.npmjs.org/
```

Regenerate types after schema changes:

```bash
npx supabase gen types typescript --local > lib/supabase/database.types.ts
```

(On Windows, use `cmd /c` redirection so the file stays UTF-8.)

## Database tests

| File | Focus |
|------|--------|
| `015_phase8a_platform_role.test.sql` | Enum, escalation, `is_platform_admin` |
| `016_phase8a_audit_logs.test.sql` | RLS, immutability, constraints |
| `017_phase8a_admin_credit_rpcs.test.sql` | Grant/revoke, idempotency, regression |

`009_credit_schema.test.sql` enum assertion updated for `admin_grant` / `admin_revoke`.

## Remote deployment

1. Push migrations to the linked Supabase project (`supabase db push` or CI).
2. Bootstrap at least one `platform_admin` profile via service-role SQL (above).
3. Deploy application (8A.1 has no new env vars).
4. Re-run pgTAP against remote/staging if available.

## Rollback / forward-fix

- Do not rewrite applied Phase 2–7 or 8A migrations.
- To disable admin credit ops without dropping schema: revoke `EXECUTE` from `service_role` on admin RPCs (emergency only).
- Forward-fix preferred for constraint/RPC adjustments.

## Out of scope (8A.1)

- `/platform` UI and `/api/platform/*` (Phase 8A.2)
- Leads (Phase 8B)
- Sentry, PostHog (Phase 8C)
- Changes to OpenAI, Inngest, try-on generation, polling, or cleanup

## Phase 8A.1 status

Database foundation implemented and covered by pgTAP. Proceed to **8A.2** for server routes and platform UI.
