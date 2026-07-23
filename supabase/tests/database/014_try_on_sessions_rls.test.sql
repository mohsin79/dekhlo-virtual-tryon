BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(8);

SELECT tests.create_auth_user('11111111-1111-1111-1111-111111111111'::uuid, 'owner-a@test.local', 'Owner A');
SELECT tests.create_auth_user('66666666-6666-6666-6666-666666666666'::uuid, 'owner-b@test.local', 'Owner B');

SELECT tests.seed_brand(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Brand A',
  'brand-a',
  '11111111-1111-1111-1111-111111111111'::uuid
);
SELECT tests.seed_brand(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  'Brand B',
  'brand-b',
  '66666666-6666-6666-6666-666666666666'::uuid
);

INSERT INTO public.products (
  id, brand_id, name, slug, product_image_path, is_active
) VALUES (
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Try On Product',
  'try-on-product',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/dddddddd-dddd-dddd-dddd-dddddddddddd/image.jpg',
  true
);

INSERT INTO public.try_on_sessions (
  id, brand_id, product_id, client_request_id, anonymous_token_hash, expires_at, status
) VALUES (
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  repeat('a', 64),
  now() + interval '1 day',
  'pending_upload'
);

SELECT tests.set_jwt_claims('11111111-1111-1111-1111-111111111111'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.try_on_sessions WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1::bigint,
  'brand owner can read own-brand sessions'
);

SELECT tests.set_jwt_claims('66666666-6666-6666-6666-666666666666'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.try_on_sessions WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  0::bigint,
  'unrelated brand owner cannot read other tenant sessions'
);

SELECT tests.clear_jwt_claims();
SET LOCAL role anon;

SELECT throws_ok(
  $$ SELECT count(*)::bigint FROM public.try_on_sessions $$,
  '42501',
  NULL,
  'anon cannot query try_on_sessions directly'
);

SELECT tests.set_jwt_claims('11111111-1111-1111-1111-111111111111'::uuid);
SET LOCAL role authenticated;

SELECT throws_ok(
  $$ SELECT anonymous_token_hash FROM public.try_on_sessions WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid $$,
  '42501',
  NULL,
  'merchant reads cannot retrieve anonymous_token_hash'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.view_column_usage
    WHERE view_schema = 'public'
      AND view_name = 'merchant_try_on_sessions'
      AND column_name = 'anonymous_token_hash'
  ),
  'merchant_try_on_sessions projection excludes anonymous_token_hash'
);

SELECT throws_ok(
  $$ UPDATE public.try_on_sessions SET status = 'failed' WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid $$,
  '42501',
  NULL,
  'authenticated merchants cannot directly update sessions'
);

SELECT throws_ok(
  $$ INSERT INTO public.try_on_sessions (id, brand_id, product_id, client_request_id, anonymous_token_hash, expires_at)
     VALUES (
       'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
       'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
       repeat('b', 64),
       now() + interval '1 day'
     ) $$,
  '42501',
  NULL,
  'authenticated merchants cannot directly insert sessions'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname ILIKE '%customer-upload%'
      AND cmd IN ('SELECT', 'INSERT')
      AND roles::text[] && ARRAY['anon']
  ),
  'anon has no storage listing policy on customer uploads'
);

SELECT * FROM finish();

ROLLBACK;
