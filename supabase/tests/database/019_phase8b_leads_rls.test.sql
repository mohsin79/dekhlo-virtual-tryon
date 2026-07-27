BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(12);

SELECT tests.create_auth_user('11111111-1111-1111-1111-111111111111'::uuid, 'owner-a@test.local', 'Owner A');
SELECT tests.create_auth_user('22222222-2222-2222-2222-222222222222'::uuid, 'admin-a@test.local', 'Admin A');
SELECT tests.create_auth_user('33333333-3333-3333-3333-333333333333'::uuid, 'editor-a@test.local', 'Editor A');
SELECT tests.create_auth_user('44444444-4444-4444-4444-444444444444'::uuid, 'analyst-a@test.local', 'Analyst A');
SELECT tests.create_auth_user('55555555-5555-5555-5555-555555555555'::uuid, 'owner-b@test.local', 'Owner B');
SELECT tests.create_auth_user('66666666-6666-6666-6666-666666666666'::uuid, 'platform@test.local', 'Platform Only');

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
  '55555555-5555-5555-5555-555555555555'::uuid
);

SELECT tests.add_member(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  'admin'::public.brand_role
);
SELECT tests.add_member(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  '33333333-3333-3333-3333-333333333333'::uuid,
  'editor'::public.brand_role
);
SELECT tests.add_member(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  '44444444-4444-4444-4444-444444444444'::uuid,
  'analyst'::public.brand_role
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
  id,
  brand_id,
  product_id,
  client_request_id,
  anonymous_token_hash,
  expires_at,
  upload_validated_at,
  person_storage_path,
  result_storage_path,
  status,
  credit_cost,
  completed_at
) VALUES (
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  repeat('f', 64),
  now() + interval '1 day',
  now(),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee/person.jpg',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee/result.png',
  'completed'::public.try_on_session_status,
  1,
  now()
);

SET LOCAL role service_role;

INSERT INTO public.leads (
  brand_id,
  product_id,
  try_on_session_id,
  email,
  consent_to_contact,
  consent_to_marketing,
  consented_at,
  source,
  idempotency_key,
  metadata
) VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
  'lead@example.com',
  true,
  false,
  now(),
  'try_on_result',
  '11111111-1111-1111-1111-111111111111',
  jsonb_build_object(
    'brand_name', 'Brand A',
    'brand_slug', 'brand-a',
    'product_name', 'Try On Product',
    'product_slug', 'try-on-product'
  )
);

SELECT tests.set_jwt_claims('11111111-1111-1111-1111-111111111111'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.leads WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1::bigint,
  'brand owner can read leads'
);

SELECT tests.set_jwt_claims('22222222-2222-2222-2222-222222222222'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.leads WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1::bigint,
  'brand admin can read leads'
);

SELECT tests.set_jwt_claims('33333333-3333-3333-3333-333333333333'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.leads WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  0::bigint,
  'brand editor cannot read leads'
);

SELECT tests.set_jwt_claims('44444444-4444-4444-4444-444444444444'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.leads WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  0::bigint,
  'brand analyst cannot read leads'
);

SELECT tests.set_jwt_claims('55555555-5555-5555-5555-555555555555'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.leads WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  0::bigint,
  'cross-brand owner cannot read other tenant leads'
);

SELECT tests.clear_jwt_claims();
SET LOCAL role anon;

SELECT throws_ok(
  $$ SELECT count(*)::bigint FROM public.leads $$,
  '42501',
  NULL,
  'anon cannot select leads'
);

SELECT tests.set_jwt_claims('11111111-1111-1111-1111-111111111111'::uuid);
SET LOCAL role authenticated;

SELECT throws_ok(
  $$
    INSERT INTO public.leads (
      brand_id, product_id, try_on_session_id, email,
      consent_to_contact, consent_to_marketing, consented_at,
      source, idempotency_key
    ) VALUES (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
      'direct@example.com',
      true, false, now(), 'try_on_result', '22222222-2222-2222-2222-222222222222'
    )
  $$,
  '42501',
  NULL,
  'authenticated cannot insert leads directly'
);

SET LOCAL role service_role;
SELECT tests.assign_platform_admin('66666666-6666-6666-6666-666666666666'::uuid);

SELECT tests.set_jwt_claims('66666666-6666-6666-6666-666666666666'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.leads WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  0::bigint,
  'platform_admin without brand membership cannot read merchant leads'
);

SELECT function_privs_are(
  'public',
  'create_try_on_lead',
  ARRAY['uuid', 'text', 'text', 'text', 'boolean', 'boolean', 'uuid', 'jsonb'],
  'anon',
  ARRAY[]::text[],
  'anon cannot execute create_try_on_lead'
);

SELECT function_privs_are(
  'public',
  'create_try_on_lead',
  ARRAY['uuid', 'text', 'text', 'text', 'boolean', 'boolean', 'uuid', 'jsonb'],
  'authenticated',
  ARRAY[]::text[],
  'authenticated cannot execute create_try_on_lead'
);

SELECT tests.set_jwt_claims('11111111-1111-1111-1111-111111111111'::uuid);
SET LOCAL role authenticated;

SELECT throws_ok(
  $$
    UPDATE public.leads
    SET email = 'changed@example.com'
    WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
  $$,
  '42501',
  NULL,
  'authenticated cannot update leads'
);

SELECT throws_ok(
  $$
    DELETE FROM public.leads
    WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
  $$,
  '42501',
  NULL,
  'authenticated cannot delete leads'
);

SELECT * FROM finish();
ROLLBACK;
