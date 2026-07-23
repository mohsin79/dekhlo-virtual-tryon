BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(24);

SELECT tests.create_auth_user('11111111-1111-1111-1111-111111111111'::uuid, 'owner-a@test.local', 'Owner A');
SELECT tests.create_auth_user('44444444-4444-4444-4444-444444444444'::uuid, 'analyst-a@test.local', 'Analyst A');
SELECT tests.create_auth_user('55555555-5555-5555-5555-555555555555'::uuid, 'unrelated@test.local', 'Unrelated');

SELECT tests.seed_brand(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Brand A',
  'brand-a',
  '11111111-1111-1111-1111-111111111111'::uuid
);
SELECT tests.add_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '44444444-4444-4444-4444-444444444444'::uuid, 'analyst');

INSERT INTO public.products (
  id,
  brand_id,
  name,
  slug,
  product_image_path,
  is_active,
  metadata
)
VALUES
  (
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'Active Product',
    'active-product',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/cccccccc-cccc-cccc-cccc-cccccccccccc/11111111-1111-1111-1111-111111111111.jpg',
    true,
    '{"internal": true}'::jsonb
  ),
  (
    'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'Inactive Product',
    'inactive-product',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/dddddddd-dddd-dddd-dddd-dddddddddddd/11111111-1111-1111-1111-111111111111.jpg',
    false,
    '{"internal": true}'::jsonb
  );

SELECT ok(
  (
    SELECT roles
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'products'
      AND policyname = 'products_select_public_active'
  ) = ARRAY['anon']::name[],
  'products_select_public_active applies to anon only'
);

SELECT tests.clear_jwt_claims();
SET LOCAL role anon;

SELECT is(
  (SELECT count(*)::bigint FROM public.products WHERE slug = 'active-product'),
  1::bigint,
  'anonymous can read an active product row'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.products WHERE slug = 'inactive-product'),
  0::bigint,
  'anonymous cannot read an inactive product row'
);

SELECT throws_ok(
  $$ SELECT metadata FROM public.products WHERE slug = 'active-product' $$,
  '42501',
  NULL,
  'anonymous cannot read product metadata column'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.public_catalog_products WHERE product_slug = 'active-product'),
  1::bigint,
  'anonymous can read active product through public catalog view'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.public_catalog_products WHERE product_slug = 'inactive-product'),
  0::bigint,
  'public catalog view excludes inactive products'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'public_catalog_products'
      AND column_name IN ('metadata', 'plan', 'created_at', 'updated_at')
  ),
  'public catalog view exposes only approved columns'
);

SELECT throws_ok(
  $$
    INSERT INTO public.public_catalog_products (product_id, product_name, product_slug)
    VALUES (
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
      'Injected',
      'injected'
    )
  $$,
  '55000',
  NULL,
  'public catalog view cannot be inserted into'
);

SELECT is(
  (SELECT product_name FROM public.get_public_product_by_slugs('brand-a', 'active-product')),
  'Active Product',
  'anonymous slug lookup returns active product'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.get_public_product_by_slugs('brand-a', 'inactive-product')),
  0::bigint,
  'slug lookup does not return inactive product'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.get_public_product_by_slugs('Invalid Slug', 'active-product')),
  0::bigint,
  'malformed brand slug returns no data'
);

SELECT tests.set_jwt_claims('55555555-5555-5555-5555-555555555555'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.products),
  0::bigint,
  'unrelated authenticated user receives zero rows from public.products'
);

SELECT is(
  (SELECT count(*)::bigint FROM (SELECT metadata FROM public.products) AS blocked),
  0::bigint,
  'unrelated authenticated user cannot retrieve metadata from another brand'
);

SELECT is(
  (SELECT product_name FROM public.get_public_product_by_slugs('brand-a', 'active-product')),
  'Active Product',
  'unrelated authenticated user can resolve active product through safe RPC'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.public_catalog_products WHERE product_slug = 'active-product'),
  1::bigint,
  'unrelated authenticated user can read active product through public catalog view'
);

SELECT tests.set_jwt_claims('44444444-4444-4444-4444-444444444444'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.products WHERE slug = 'active-product'),
  1::bigint,
  'brand member can query own products directly'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.products WHERE slug = 'inactive-product'),
  1::bigint,
  'brand member can read own inactive products directly'
);

SELECT is(
  (SELECT metadata ->> 'internal' FROM public.products WHERE slug = 'active-product'),
  'true',
  'brand member can read own product metadata directly'
);

UPDATE public.products
SET name = 'Blocked Update'
WHERE slug = 'active-product';

SELECT is(
  (SELECT name FROM public.products WHERE slug = 'active-product'),
  'Active Product',
  'analyst remains read-only for products'
);

SELECT tests.clear_jwt_claims();
SET LOCAL role anon;

SELECT throws_ok(
  $$
    INSERT INTO public.products (brand_id, name, slug, product_image_path)
    VALUES (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      'Anon Product',
      'anon-product',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/00000000-0000-0000-0000-000000000000/11111111-1111-1111-1111-111111111111.jpg'
    )
  $$,
  '42501',
  NULL,
  'anonymous users cannot insert products'
);

SELECT tests.set_jwt_claims('55555555-5555-5555-5555-555555555555'::uuid);
SET LOCAL role authenticated;

SELECT throws_ok(
  $$
    UPDATE public.public_catalog_products
    SET product_name = 'Blocked Update'
    WHERE product_slug = 'active-product'
  $$,
  '55000',
  NULL,
  'public catalog view cannot be updated'
);

SELECT throws_ok(
  $$
    DELETE FROM public.public_catalog_products
    WHERE product_slug = 'active-product'
  $$,
  '55000',
  NULL,
  'public catalog view cannot be deleted from'
);

UPDATE public.products
SET name = 'Blocked Update'
WHERE slug = 'active-product';

SELECT is(
  (SELECT product_name FROM public.get_public_product_by_slugs('brand-a', 'active-product')),
  'Active Product',
  'unrelated authenticated users cannot update products'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'products'
      AND cmd = 'ALL'
  ),
  0::bigint,
  'products has no FOR ALL policy'
);

SELECT * FROM finish();

ROLLBACK;
