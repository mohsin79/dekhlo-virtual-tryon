# Supabase Phase 2 — Tenant Schema and Row Level Security

Phase 2 adds the core multi-tenant database schema (`profiles`, `brands`, `brand_members`), explicit grants, SECURITY DEFINER helpers, auth profile trigger, and pgTAP policy tests. Atomic brand onboarding remains deferred to Phase 3.

## Supabase CLI

- **Package:** `supabase@2.109.1` (devDependency)
- **Invocation:** `npx supabase …`
- **Local Postgres:** Docker required (`npx supabase start`)

## Local setup

```bash
npx supabase start
npx supabase db reset --local
npx supabase test db --local
npx supabase db lint --local
```

On Windows, generate UTF-8 types with Node (avoid PowerShell redirect encoding issues):

```bash
node -e "const {spawnSync}=require('child_process');const fs=require('fs');const r=spawnSync('npx',['supabase','gen','types','typescript','--local'],{encoding:'buffer',shell:true});if(r.status)process.exit(r.status);fs.writeFileSync('lib/supabase/database.types.ts',r.stdout);"
```

## Migrations

| File | Purpose |
|------|---------|
| `20260722140000_phase2_tenant_schema.sql` | Enum, tables, indexes, `updated_at` triggers |
| `20260722140100_phase2_functions_and_triggers.sql` | `handle_new_user`, `user_has_brand_role` |
| `20260722140200_phase2_grants.sql` | Explicit table/type grants |
| `20260722140300_phase2_rls_policies.sql` | RLS policies (separate per command) |

Seed is disabled in `supabase/config.toml` (fixtures live in pgTAP tests).

## Schema

### `public.brand_role` enum

`owner`, `admin`, `editor`, `analyst`

### `public.profiles`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK/FK → `auth.users.id` ON DELETE CASCADE | |
| `full_name` | `text NOT NULL DEFAULT ''` | From signup metadata (optional, truncated) |
| `avatar_path` | `text` nullable | Storage path only |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` trigger |

No `platform_role` (Phase 8).

### `public.brands`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `name` | `text NOT NULL` | |
| `slug` | `text NOT NULL` | Unique; CHECK `^[a-z0-9]+(?:-[a-z0-9]+)*$` |
| `logo_path` | `text` nullable | Storage path only |
| `plan` | `text` nullable | Future billing |
| `widget_config` | `jsonb NOT NULL DEFAULT '{}'` | |
| `created_at`, `updated_at` | `timestamptz` | |

No product, billing, or credit columns.

### `public.brand_members`

| Column | Type | Notes |
|--------|------|-------|
| `brand_id` | `uuid` FK → `brands.id` ON DELETE CASCADE | Composite PK |
| `user_id` | `uuid` FK → `profiles.id` ON DELETE CASCADE | |
| `role` | `public.brand_role NOT NULL` | |

Unique membership enforced by composite primary key.

### Indexes

- `brands_slug_key` (unique on `slug`)
- `brand_members_user_id_idx`
- `brand_members_brand_id_idx`

## Helper functions

### `public.set_updated_at()`

Standard trigger function for `profiles` and `brands`.

### `public.handle_new_user()` — SECURITY DEFINER

- Trigger: `AFTER INSERT ON auth.users`
- `SET search_path = ''`; schema-qualified identifiers
- Inserts `public.profiles` with optional `full_name` from metadata (never used for authorization)
- `ON CONFLICT (id) DO NOTHING` for signup safety
- `REVOKE ALL FROM PUBLIC`

### `public.user_has_brand_role(uuid, brand_role[])` — SECURITY DEFINER

- Uses `auth.uid()` only (no caller-supplied user id)
- Returns `false` when unauthenticated
- Bypasses RLS to avoid recursive policy evaluation on `brand_members`
- `REVOKE ALL FROM PUBLIC`; `GRANT EXECUTE` to `authenticated`, `service_role`

## Grants

| Role | Privileges |
|------|------------|
| `anon` | `USAGE` on `public` schema only (no table access) |
| `authenticated` | `SELECT`, `UPDATE` on `profiles`; `SELECT`, `UPDATE`, `DELETE` on `brands`; full DML on `brand_members`; `USAGE` on `brand_role` enum |
| `service_role` | Full table access for trusted server administration |

No `GRANT ALL` to `anon` or broad write grants to `authenticated` on `brands`.

## RLS policy matrix

**Total: 10 policies** (3 on `profiles`, 3 on `brands`, 4 on `brand_members`). No `FOR ALL` policies. No client `INSERT` policy on `brands`.

### `profiles`

| Command | Policy | Rule |
|---------|--------|------|
| SELECT | `profiles_select_own` | `id = auth.uid()` |
| UPDATE | `profiles_update_own` | own row only |
| INSERT | `profiles_insert_own` | `id = auth.uid()` (recovery path; primary creation via trigger) |

### `brands`

| Command | Policy | Rule |
|---------|--------|------|
| SELECT | `brands_select_members` | any member role |
| UPDATE | `brands_update_owner_admin` | owner or admin |
| DELETE | `brands_delete_owner` | owner only |
| INSERT | *(none)* | deferred to Phase 3 onboarding RPC |

### `brand_members`

| Command | Policy | Rule |
|---------|--------|------|
| SELECT | `brand_members_select_members` | any member of brand |
| INSERT | `brand_members_insert_owner_admin` | owner/admin invite; not `owner` role; not self |
| UPDATE | `brand_members_update_owner` | owner only; not self; cannot assign `owner` |
| DELETE | `brand_members_delete_owner_admin` | owner/admin; not self; not `owner` rows |

## Atomic brand creation

**Deferred to Phase 3.** There is no client `INSERT` policy on `brands`, so authenticated users cannot create ownerless brands directly. Phase 3 will add an onboarding RPC that creates the brand and initial owner membership in one transaction.

## Database tests

Location: `supabase/tests/database/`

| File | Coverage |
|------|----------|
| `000_helpers.sql` | Test fixtures (`tests` schema helpers) |
| `001_schema.test.sql` | Tables, enum, keys, indexes, RLS enabled, policies |
| `002_triggers.test.sql` | Profile trigger, cascade delete, helper existence |
| `003_rls.test.sql` | Positive/negative authorization by role |

Run: `npx supabase test db --local` (74 assertions, all passing locally).

## Generated TypeScript types

- **File:** `lib/supabase/database.types.ts`
- **Clients typed:** `lib/supabase/client.ts`, `server.ts`, `admin.ts` (generics only; no runtime behavior change)

## Remote deployment

Deployed **2026-07-22** to the linked **Dekhlo** project (ap-south-1). Project reference is stored only in `supabase/.temp/` (gitignored).

### Commands run

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
npx supabase migration list
npx supabase db lint --linked --fail-on error
```

### Dry-run result

Only the four Phase 2 migrations were queued:

- `20260722140000_phase2_tenant_schema.sql`
- `20260722140100_phase2_functions_and_triggers.sql`
- `20260722140200_phase2_grants.sql`
- `20260722140300_phase2_rls_policies.sql`

### Push result

All four migrations applied successfully. A non-fatal pg-delta cache warning appeared after apply; migration history confirms all four versions on remote.

### Migration sync

| Local | Remote |
|-------|--------|
| `20260722140000` | `20260722140000` |
| `20260722140100` | `20260722140100` |
| `20260722140200` | `20260722140200` |
| `20260722140300` | `20260722140300` |

### Remote verification summary

| Check | Result |
|-------|--------|
| Tables | `profiles`, `brands`, `brand_members` only (no Phase 3+ tables) |
| `brand_role` enum | `owner`, `admin`, `editor`, `analyst` |
| RLS enabled | All three tenant tables |
| Policies | 10 (exact names match migration) |
| `FOR ALL` policies | None |
| PKs / FKs | `profiles_pkey`, `profiles_id_fkey`, `brands_pkey`, `brand_members_pkey`, member FKs |
| Indexes | `brands_slug_key`, `brand_members_user_id_idx`, `brand_members_brand_id_idx` |
| Triggers | `on_auth_user_created`, `profiles_set_updated_at`, `brands_set_updated_at` |
| `user_has_brand_role` args | `p_brand_id uuid, p_roles brand_role[]` |
| SECURITY DEFINER `search_path` | Empty (`''`) on `handle_new_user`, `user_has_brand_role` |
| PUBLIC function EXECUTE | Revoked on sensitive helpers |
| `anon` table grants | None |
| `authenticated` / `service_role` grants | Match migration design |

### Remote lint

`npx supabase db lint --linked --fail-on error` — **no schema errors**.

### Remote type comparison

Generated linked types to `supabase/.temp/database.types.remote.ts` (ignored). The `public` schema block matches `lib/supabase/database.types.ts` exactly. Wrapper differences (`graphql_public` in local-only generation, `__InternalSupabase` in linked output) are expected and do not affect tenant types. Temporary comparison file deleted.

## Rollback

Revert migrations in reverse order on a branch database, or restore from Supabase backup. Do not edit production schema via the Dashboard.

## Known limitations (Phase 3+)

- Auth UI, onboarding UI, dashboard
- Atomic `create_brand` RPC
- `products`, credits, storage buckets, try-on sessions
- `platform_role`, audit logs, billing

## Security note

This document and tracked files contain **no** Supabase access tokens, database passwords, secret keys, or connection strings.
