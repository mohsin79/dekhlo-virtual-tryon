BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(16);

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
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'products'
      AND policyname = 'products_select_public_active'
      AND cmd = 'SELECT'
  ),
  'products_select_public_active policy exists'
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
  'public catalog view does not expose internal columns'
);

SELECT is(
  (SELECT product_name FROM public.get_public_product_by_slugs('brand-a', 'active-product')),
  'Active Product',
  'slug lookup returns active product'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.get_public_product_by_slugs('brand-a', 'inactive-product')),
  0::bigint,
  'slug lookup does not return inactive product'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.get_public_product_by_slugs('missing-brand', 'active-product')),
  0::bigint,
  'invalid brand slug returns no data'
);

SELECT tests.set_jwt_claims('55555555-5555-5555-5555-555555555555'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.products WHERE slug = 'active-product'),
  1::bigint,
  'unrelated authenticated user can read active products'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.products WHERE slug = 'inactive-product'),
  0::bigint,
  'unrelated authenticated user cannot read inactive products'
);

SELECT tests.set_jwt_claims('44444444-4444-4444-4444-444444444444'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.products WHERE slug = 'inactive-product'),
  1::bigint,
  'brand analyst can read inactive products for own brand'
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
