# Supabase Phase 4 — Merchant Product Catalog and Product Images Storage

Phase 4 adds the merchant product catalog (`public.products`), RLS for tenant-scoped product management, the public `product-images` Storage bucket, dashboard CRUD routes, and server-side image validation. Customer uploads, try-on sessions, credits, and public try-on product routes remain deferred.

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
npx supabase gen types typescript --local --schema public > lib/supabase/database.types.ts
```

On Windows, use Node to avoid PowerShell redirect encoding issues (see Phase 2 docs).

## Migrations

| File | Purpose |
|------|---------|
| `20260723100000_phase4_products_schema.sql` | `public.products` table, indexes, triggers |
| `20260723100100_phase4_products_rls_grants.sql` | Table grants and RLS policies |
| `20260723100200_phase4_product_images_storage.sql` | `product-images` bucket, path helpers, Storage RLS |
| `20260723110000_phase4_public_catalog_read.sql` | Public active-product read policy, catalog view, slug RPC |

Do **not** edit Phase 2 or Phase 3 migration files.

## `public.products` schema

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `brand_id` | `uuid NOT NULL` FK → `brands.id` ON DELETE CASCADE | Immutable after insert |
| `name` | `text NOT NULL` | Non-empty (CHECK) |
| `slug` | `text NOT NULL` | Unique per brand; CHECK `^[a-z0-9]+(?:-[a-z0-9]+)*$` |
| `product_image_path` | `text NOT NULL` | Relative Storage path only (no URLs) |
| `category` | `text` nullable | Optional; unused in Phase 4 UI |
| `is_active` | `boolean NOT NULL DEFAULT true` | Merchant activate/deactivate |
| `metadata` | `jsonb NOT NULL DEFAULT '{}'` | Extension point |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` via `set_updated_at()` |

### Constraints and indexes

- `products_brand_slug_key` — unique `(brand_id, slug)`
- `products_brand_id_idx` — brand product listing
- `products_brand_active_idx` — partial index on `(brand_id, is_active)` where `is_active = true`
- `products_prevent_brand_change` trigger — blocks cross-tenant `brand_id` updates

No price, SKU, stock, variants, or analytics columns.

## Product visibility model

Per `docs/saas-architecture.md` §4.4 and Phase 4 scope:

- **Authenticated brand members** (owner, admin, editor, analyst) can `SELECT` all products for brands they belong to, including inactive products.
- **Anonymous users and unrelated authenticated users** may read **only active products** (`is_active = true`) through the public catalog read foundation.
- **Inactive products** remain merchant-only for non-members.
- **`/try/[brandSlug]/[productSlug]` UI and try-on sessions** remain **Phase 6**. Phase 4 provides the database/public-read foundation only.

### Public read surfaces

Phase 4 exposes three complementary surfaces (publishable client + RLS, no secret key):

| Surface | Purpose |
|---------|---------|
| `products_select_public_active` | Table-level SELECT for active rows (`anon`, `authenticated`) |
| `public.public_catalog_products` | Safe-column view joining active products with public brand fields |
| `public.get_public_product_by_slugs(text, text)` | Slug lookup for future try-on route resolution |

The `product-images` bucket is **public** so rendered catalog images can use `getPublicUrl()` at display time.

### Publicly exposed fields

**Products (anon column grants + active-row policy):**

- `id`, `brand_id`, `name`, `slug`, `product_image_path`, `category`, `is_active`

**Not exposed to `anon` on `public.products`:**

- `metadata` (merchant extension point — may contain internal data)
- `created_at`, `updated_at`

**View / RPC brand fields:**

- `brand_id`, `brand_name`, `brand_slug`, `logo_path`, `widget_config`

**Not exposed publicly:**

- `brands.plan`
- membership, profile, credit, or session data
- product `metadata`
- private storage paths outside approved public catalog fields

Unrelated authenticated users can still read `metadata` on active products via the full authenticated table grant if they query `public.products` directly. Phase 6 public try-on UI should use `public_catalog_products` or `get_public_product_by_slugs()` rather than ad-hoc table selects.

## Product role matrix

| Role | SELECT | INSERT | UPDATE | DELETE | Activate/deactivate |
|------|--------|--------|--------|--------|---------------------|
| owner | yes | yes | yes | yes | yes |
| admin | yes | yes | yes | yes | yes |
| editor | yes | yes | yes | yes | yes |
| analyst | yes | no | no | no | no |
| unrelated authenticated | active only | no | no | no | no |
| anon | active only | no | no | no | no |

Authorization uses `public.user_has_brand_role()` with `auth.uid()` only. No role from form data or Auth metadata.

Public catalog reads use RLS policy `products_select_public_active` plus the safe view/RPC surfaces above. No anonymous INSERT, UPDATE, or DELETE grants exist.

## Product RLS policies

Five separate policies (no `FOR ALL`):

| Command | Policy | Rule |
|---------|--------|------|
| SELECT | `products_select_members` | owner, admin, editor, or analyst on `brand_id` |
| SELECT | `products_select_public_active` | `anon`, `authenticated`; `is_active = true` |
| INSERT | `products_insert_editors` | owner, admin, or editor; `WITH CHECK` on `brand_id` |
| UPDATE | `products_update_editors` | owner, admin, or editor; `USING` + `WITH CHECK` on `brand_id` |
| DELETE | `products_delete_editors` | owner, admin, or editor on `brand_id` |

Merchant members reading inactive products use `products_select_members`. Public callers only receive active rows.

## Table grants

| Role | Privileges |
|------|------------|
| `anon` | `SELECT` on safe product columns only; `SELECT` on `public_catalog_products`; `EXECUTE` on `get_public_product_by_slugs` |
| `authenticated` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` on `products`; public catalog view/RPC access |
| `service_role` | `ALL` (trusted infrastructure only; app does not use for merchant CRUD) |

No anonymous write grants on `public.products`.

## `product-images` Storage bucket

Created in migration (not manually in Dashboard):

| Setting | Value |
|---------|-------|
| Bucket ID | `product-images` |
| Public | `true` |
| Max file size | 5 MB (`5242880` bytes) |
| Allowed MIME types | `image/jpeg`, `image/png`, `image/webp` |

**Not created:** `customer-uploads`, `try-on-results`.

### Why only merchant product images are public

Catalog images are intentionally public so merchant dashboards and future public try-on pages can render `<img>` tags via `getPublicUrl()` without signed URLs. **Customer/person photos must never use this bucket** — they belong in private buckets (Phase 6) with short-lived signed URLs.

## Storage path convention

Server-generated paths only:

```
{brand_id}/{product_id}/{file_id}.{ext}
```

- `brand_id` — first segment for tenant-scoped Storage RLS
- `product_id` — product UUID
- `file_id` — new random UUID per upload
- `ext` — `jpg`, `jpeg`, `png`, or `webp` from validated MIME type

Never trust client filenames or paths. Never store full Supabase URLs in PostgreSQL.

### Path helper functions

| Function | Purpose |
|----------|---------|
| `public.storage_product_images_brand_id(text)` | Safely extracts brand UUID from path; returns `NULL` for malformed input |
| `public.is_valid_product_image_path(text)` | Validates tenant path shape and extension |

Both use `SET search_path = ''`. Execution granted to `authenticated` and `service_role` only.

## Storage RLS policies

Two policies on `storage.objects` (no `FOR ALL`, no UPDATE policy — replacement uses new upload + delete):

| Command | Policy | Rule |
|---------|--------|------|
| INSERT | `product_images_insert_editors` | `bucket_id = 'product-images'`, valid path, editor+ role on path brand |
| DELETE | `product_images_delete_editors` | same checks for delete |

No anonymous INSERT/DELETE. No broad anonymous SELECT/list policy — public bucket serves direct object URLs.

## Upload validation (application)

Server-side validation in `lib/products/image-validation.ts`:

- File required on create; optional on edit (retain current image)
- Non-zero size, max 5 MB
- Declared MIME in allow-list
- Magic-byte signature match (JPEG, PNG, WebP)
- Server-generated path via `buildProductImageStoragePath()`
- No Sharp, no server-side decode/resize
- Product previews use native `<img>` (not `next/image`)

## Create / update / delete compensation

Database and Storage are **not** one atomic transaction.

### Create

1. Validate auth, brand, fields, image
2. Upload to unique path (`upsert: false`)
3. Insert product row
4. On insert failure → delete uploaded object
5. Revalidate and redirect

### Image replacement

1. Upload new object to new path
2. Update `product_image_path`
3. On update failure → delete new object
4. On success → delete previous object

### Delete

1. Read path via RLS-scoped query
2. Delete product row
3. Delete Storage object (warn server-side on cleanup failure)

Orphan objects may remain if cleanup fails; document for later janitorial tasks.

## Public URL derivation

`lib/products/public-url.ts` — server-only helper:

```typescript
supabase.storage.from("product-images").getPublicUrl(path)
```

Accepts relative paths only. Does not persist URLs. No signed URLs for catalog images.

## Application routes

| Route | Purpose |
|-------|---------|
| `/dashboard/products` | Product list (current brand) |
| `/dashboard/products/new` | Create product (managers only) |
| `/dashboard/products/[productId]/edit` | Edit or analyst read-only view |

Server Actions in `app/dashboard/products/actions.ts`:

- `createProductAction`
- `updateProductAction`
- `deleteProductAction`
- `toggleProductActiveAction`

## Database tests

| File | Assertions |
|------|------------|
| `005_products_schema.test.sql` | 21 |
| `006_products_rls.test.sql` | 11 |
| `007_product_images_storage.test.sql` | 13 |
| `008_public_catalog_read.test.sql` | 16 |

**Total Phase 4:** 61 assertions. Full suite: 153 tests.

## Remote deployment

```bash
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
npx supabase db lint --linked --schema public --fail-on error
```

Verify remotely:

- `public.products` exists with expected columns and RLS
- Four product policies, no `FOR ALL`
- `product-images` bucket public with correct limits
- Storage INSERT/DELETE policies present
- No `customer-uploads`, `try-on-results`, `try_on_sessions`, or credit tables

Compare linked types to committed local types:

```bash
npx supabase gen types typescript --linked --schema public > database.types.remote.ts
```

Do **not** run `db reset` against the linked project.

## Generated type changes

`lib/supabase/database.types.ts` gains the `products` table and Phase 4 helper function types. Do not hand-edit generated rows.

## Security review

- Merchant product operations use authenticated RLS-scoped Supabase client only
- No service role in product routes or Server Actions
- `brand_id` from validated session context, not form input
- Image paths generated server-side; no path traversal
- MIME + magic-byte validation; SVG/HTML/GIF rejected
- No signed or full Storage URLs stored in PostgreSQL
- Analyst read-only; delete/update via POST Server Actions only
- `images.unoptimized: true` retained in `next.config.mjs`

## Rollback strategy

1. Revert application deploy
2. Drop Phase 4 policies and `public.products` only if no production data depends on them
3. Empty and remove `product-images` bucket via Dashboard or controlled migration
4. Do not modify already-applied Phase 2/3 migrations

## Deferred to later phases

| Phase | Feature |
|-------|---------|
| 5 | Credits, reservations, billing |
| 6 | `try_on_sessions`, customer uploads, try-on results, public `/try/[brandSlug]/[productSlug]` page UI, session API |
| — | Homepage move to `/demo`, analytics, Inngest, Resend, team invitations |

## Manual verification checklist

1. Log in as brand owner
2. Open `/dashboard/products` — empty state
3. Create product with JPEG/PNG/WebP under 5 MB
4. Confirm row exists; `product_image_path` is relative only
5. Confirm object in `product-images`; public image renders
6. Edit name/slug; replace image (new path; old object removed)
7. Analyst: view only, no mutations
8. Unrelated user: no access via merchant routes
9. Delete product; row and object removed
10. Homepage try-on UI still works

## Security reminders

No credentials, tokens, or service role keys belong in this document or committed env files.
