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

After local reset, tests, and lint pass:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

Use the project reference from your Supabase dashboard or `NEXT_PUBLIC_SUPABASE_URL` — do not commit it to the repository.

Verify remotely: three tables exist, RLS enabled, expected policies present, no Phase 3+ tables.

## Rollback

Revert migrations in reverse order on a branch database, or restore from Supabase backup. Do not edit production schema via the Dashboard.

## Known limitations (Phase 3+)

- Auth UI, onboarding UI, dashboard
- Atomic `create_brand` RPC
- `products`, credits, storage buckets, try-on sessions
- `platform_role`, audit logs, billing

## Security note

This document and tracked files contain **no** Supabase access tokens, database passwords, secret keys, or connection strings.
