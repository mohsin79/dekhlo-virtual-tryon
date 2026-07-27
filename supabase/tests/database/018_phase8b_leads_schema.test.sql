BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(16);

SELECT has_table('public', 'leads', 'leads table exists');

SELECT col_type_is('public', 'leads', 'id', 'uuid', 'leads.id is uuid');
SELECT col_not_null('public', 'leads', 'try_on_session_id', 'try_on_session_id is required');

SELECT has_index('public', 'leads', 'leads_try_on_session_id_key', 'unique try_on_session_id index exists');
SELECT has_index('public', 'leads', 'leads_idempotency_key_key', 'unique idempotency_key index exists');

SELECT tests.create_auth_user('11111111-1111-1111-1111-111111111111'::uuid, 'owner-a@test.local', 'Owner A');
SELECT tests.seed_brand(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Brand A',
  'brand-a',
  '11111111-1111-1111-1111-111111111111'::uuid
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
  '22222222-2222-2222-2222-222222222222'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  '33333333-3333-3333-3333-333333333333',
  repeat('b', 64),
  now() + interval '1 day',
  now(),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/22222222-2222-2222-2222-222222222222/person.jpg',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/22222222-2222-2222-2222-222222222222/result.png',
  'completed'::public.try_on_session_status,
  1,
  now()
);

SELECT has_function(
  'public',
  'create_try_on_lead',
  ARRAY['uuid', 'text', 'text', 'text', 'boolean', 'boolean', 'uuid', 'jsonb'],
  'create_try_on_lead exists'
);

SELECT function_privs_are(
  'public',
  'create_try_on_lead',
  ARRAY['uuid', 'text', 'text', 'text', 'boolean', 'boolean', 'uuid', 'jsonb'],
  'authenticated',
  ARRAY[]::text[],
  'authenticated cannot execute create_try_on_lead'
);

SET LOCAL role service_role;

SELECT is(
  (
    SELECT g.was_created
    FROM public.create_try_on_lead(
      '22222222-2222-2222-2222-222222222222'::uuid,
      'Shopper Name',
      'Shopper@Example.com',
      '+923001234567',
      true,
      false,
      '44444444-4444-4444-4444-444444444444'::uuid,
      jsonb_build_object(
        'brand_name', 'Brand A',
        'brand_slug', 'brand-a',
        'product_name', 'Try On Product',
        'product_slug', 'try-on-product'
      )
    ) AS g
  ),
  true,
  'create_try_on_lead inserts a lead for completed session'
);

SELECT is(
  (
    SELECT g.was_created
    FROM public.create_try_on_lead(
      '22222222-2222-2222-2222-222222222222'::uuid,
      'Shopper Name',
      'shopper@example.com',
      '+923001234567',
      true,
      false,
      '44444444-4444-4444-4444-444444444444'::uuid,
      jsonb_build_object(
        'brand_name', 'Brand A',
        'brand_slug', 'brand-a',
        'product_name', 'Try On Product',
        'product_slug', 'try-on-product'
      )
    ) AS g
  ),
  false,
  'identical lead replay returns was_created false'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.create_try_on_lead(
      '22222222-2222-2222-2222-222222222222'::uuid,
      'Different Name',
      'shopper@example.com',
      '+923001234567',
      true,
      false,
      '55555555-5555-5555-5555-555555555555'::uuid,
      jsonb_build_object(
        'brand_name', 'Brand A',
        'brand_slug', 'brand-a',
        'product_name', 'Try On Product',
        'product_slug', 'try-on-product'
      )
    )
  $$,
  '23505',
  NULL,
  'conflicting lead payload raises conflict'
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
  status,
  credit_cost
) VALUES (
  '66666666-6666-6666-6666-666666666666'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  '77777777-7777-7777-7777-777777777777',
  repeat('c', 64),
  now() + interval '1 day',
  now(),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/66666666-6666-6666-6666-666666666666/person.jpg',
  'queued'::public.try_on_session_status,
  1
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.create_try_on_lead(
      '66666666-6666-6666-6666-666666666666'::uuid,
      NULL,
      'queued@example.com',
      NULL,
      true,
      false,
      '88888888-8888-8888-8888-888888888888'::uuid,
      jsonb_build_object(
        'brand_name', 'Brand A',
        'brand_slug', 'brand-a',
        'product_name', 'Try On Product',
        'product_slug', 'try-on-product'
      )
    )
  $$,
  'P0001',
  NULL,
  'non-completed session rejected'
);

UPDATE public.try_on_sessions
SET deleted_at = now()
WHERE id = '66666666-6666-6666-6666-666666666666'::uuid;

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
  completed_at,
  deleted_at
) VALUES (
  '99999999-9999-9999-9999-999999999999'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  repeat('d', 64),
  now() + interval '1 day',
  now(),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/99999999-9999-9999-9999-999999999999/person.jpg',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/99999999-9999-9999-9999-999999999999/result.png',
  'completed'::public.try_on_session_status,
  1,
  now(),
  now()
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.create_try_on_lead(
      '99999999-9999-9999-9999-999999999999'::uuid,
      NULL,
      'deleted@example.com',
      NULL,
      true,
      false,
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
      jsonb_build_object(
        'brand_name', 'Brand A',
        'brand_slug', 'brand-a',
        'product_name', 'Try On Product',
        'product_slug', 'try-on-product'
      )
    )
  $$,
  'P0001',
  NULL,
  'soft-deleted session rejected'
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
  'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  repeat('e', 64),
  now() - interval '1 hour',
  now(),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa/person.jpg',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa/result.png',
  'completed'::public.try_on_session_status,
  1,
  now() - interval '2 hours'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.create_try_on_lead(
      'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      NULL,
      'expired@example.com',
      NULL,
      true,
      false,
      'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      jsonb_build_object(
        'brand_name', 'Brand A',
        'brand_slug', 'brand-a',
        'product_name', 'Try On Product',
        'product_slug', 'try-on-product'
      )
    )
  $$,
  'P0001',
  NULL,
  'expired session rejected'
);

SELECT throws_ok(
  $$
    UPDATE public.leads
    SET email = 'changed@example.com'
    WHERE try_on_session_id = '22222222-2222-2222-2222-222222222222'::uuid
  $$,
  '42501',
  NULL,
  'lead update rejected'
);

SELECT throws_ok(
  $$
    DELETE FROM public.leads
    WHERE try_on_session_id = '22222222-2222-2222-2222-222222222222'::uuid
  $$,
  '42501',
  NULL,
  'lead delete rejected'
);

SELECT is(
  (SELECT lower(email) FROM public.leads WHERE try_on_session_id = '22222222-2222-2222-2222-222222222222'::uuid),
  'shopper@example.com',
  'email stored normalized lowercase'
);

SELECT * FROM finish();
ROLLBACK;
