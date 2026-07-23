BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(9);

SELECT tests.create_auth_user('11111111-1111-1111-1111-111111111111'::uuid, 'owner-a@test.local', 'Owner A');
SELECT tests.create_auth_user('22222222-2222-2222-2222-222222222222'::uuid, 'admin-a@test.local', 'Admin A');
SELECT tests.create_auth_user('33333333-3333-3333-3333-333333333333'::uuid, 'editor-a@test.local', 'Editor A');
SELECT tests.create_auth_user('44444444-4444-4444-4444-444444444444'::uuid, 'analyst-a@test.local', 'Analyst A');
SELECT tests.create_auth_user('55555555-5555-5555-5555-555555555555'::uuid, 'unrelated@test.local', 'Unrelated');
SELECT tests.create_auth_user('66666666-6666-6666-6666-666666666666'::uuid, 'owner-b@test.local', 'Owner B');

SELECT tests.seed_brand(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Brand A',
  'brand-a',
  '11111111-1111-1111-1111-111111111111'::uuid
);
SELECT tests.add_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'admin');
SELECT tests.add_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '33333333-3333-3333-3333-333333333333'::uuid, 'editor');
SELECT tests.add_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '44444444-4444-4444-4444-444444444444'::uuid, 'analyst');

SELECT tests.seed_brand(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  'Brand B',
  'brand-b',
  '66666666-6666-6666-6666-666666666666'::uuid
);

SELECT tests.set_jwt_claims('33333333-3333-3333-3333-333333333333'::uuid);
SET LOCAL role authenticated;

INSERT INTO public.products (
  id,
  brand_id,
  name,
  slug,
  product_image_path
)
VALUES (
  'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Product A',
  'product-a',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/cccccccc-cccc-cccc-cccc-cccccccccccc/11111111-1111-1111-1111-111111111111.jpg'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.products WHERE slug = 'product-a'),
  1::bigint,
  'editor can create product for own brand'
);

SELECT tests.set_jwt_claims('44444444-4444-4444-4444-444444444444'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.products WHERE slug = 'product-a'),
  1::bigint,
  'analyst can read brand products'
);

SELECT throws_ok(
  $$
    INSERT INTO public.products (brand_id, name, slug, product_image_path)
    VALUES (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      'Analyst Product',
      'analyst-product',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/00000000-0000-0000-0000-000000000000/11111111-1111-1111-1111-111111111111.jpg'
    )
  $$,
  '42501',
  NULL,
  'analyst cannot create products'
);

SELECT tests.set_jwt_claims('55555555-5555-5555-5555-555555555555'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.products WHERE slug = 'product-a'),
  0::bigint,
  'unrelated user cannot read private products'
);

SELECT throws_ok(
  $$
    INSERT INTO public.products (brand_id, name, slug, product_image_path)
    VALUES (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      'Cross Tenant Product',
      'cross-tenant',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/00000000-0000-0000-0000-000000000000/11111111-1111-1111-1111-111111111111.jpg'
    )
  $$,
  '42501',
  NULL,
  'unrelated user cannot create products'
);

SELECT tests.set_jwt_claims('33333333-3333-3333-3333-333333333333'::uuid);
SET LOCAL role authenticated;

SELECT throws_ok(
  $$
    UPDATE public.products
    SET brand_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
    WHERE slug = 'product-a'
  $$,
  '42501',
  NULL,
  'product brand_id cannot move across tenants'
);

SELECT tests.clear_jwt_claims();
SET LOCAL role anon;

SELECT throws_ok(
  $$ SELECT count(*)::bigint FROM public.products $$,
  '42501',
  NULL,
  'anonymous users cannot read products directly'
);

SELECT tests.set_jwt_claims('22222222-2222-2222-2222-222222222222'::uuid);
SET LOCAL role authenticated;

UPDATE public.products
SET name = 'Product A Updated'
WHERE slug = 'product-a';

SELECT is(
  (SELECT name FROM public.products WHERE slug = 'product-a'),
  'Product A Updated',
  'admin can update products'
);

DELETE FROM public.products WHERE slug = 'product-a';

SELECT is(
  (SELECT count(*)::bigint FROM public.products WHERE slug = 'product-a'),
  0::bigint,
  'admin can delete products'
);

SELECT * FROM finish();

ROLLBACK;
