BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(34);

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

INSERT INTO public.products (
  id, brand_id, name, slug, product_image_path, is_active
) VALUES (
  '99999999-9999-9999-9999-999999999999'::uuid,
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  'Brand B Product',
  'brand-b-product',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/99999999-9999-9999-9999-999999999999/image.jpg',
  true
);

SELECT throws_ok(
  $$
    INSERT INTO public.try_on_sessions (
      id, brand_id, product_id, client_request_id, anonymous_token_hash, expires_at
    ) VALUES (
      '11111111-1111-1111-1111-111111111111'::uuid,
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      '99999999-9999-9999-9999-999999999999'::uuid,
      '11111111-1111-1111-1111-111111111111',
      repeat('c', 64),
      now() + interval '1 day'
    )
  $$,
  '23503',
  NULL,
  'cross-brand product_id is rejected by composite foreign key'
);

INSERT INTO public.try_on_sessions (
  id, brand_id, product_id, client_request_id, anonymous_token_hash, expires_at
) VALUES (
  '22222222-2222-2222-2222-222222222222'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  '33333333-3333-3333-3333-333333333333',
  repeat('d', 64),
  now() + interval '1 day'
);

SELECT throws_ok(
  $$
    INSERT INTO public.try_on_sessions (
      id, brand_id, product_id, client_request_id, anonymous_token_hash, expires_at
    ) VALUES (
      '44444444-4444-4444-4444-444444444444'::uuid,
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
      '33333333-3333-3333-3333-333333333333',
      repeat('e', 64),
      now() + interval '1 day'
    )
  $$,
  '23505',
  NULL,
  'client_request_id uniqueness is enforced'
);

SET LOCAL role service_role;

SELECT throws_ok(
  $$
    SELECT * FROM public.queue_try_on_session('22222222-2222-2222-2222-222222222222'::uuid)
  $$,
  '22023',
  NULL,
  'queue rejects session without validated upload'
);

UPDATE public.try_on_sessions
SET upload_validated_at = now()
WHERE id = '22222222-2222-2222-2222-222222222222'::uuid;

SELECT throws_ok(
  $$
    SELECT * FROM public.queue_try_on_session('22222222-2222-2222-2222-222222222222'::uuid)
  $$,
  'P0001',
  NULL,
  'queue rejects session when brand has insufficient credits'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.grant_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      10,
      'phase6-lifecycle-grant',
      '{"source":"pgtap"}'::jsonb
    )
  $$,
  'seed credits for lifecycle queue tests'
);

UPDATE public.products SET is_active = false WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid;

INSERT INTO public.try_on_sessions (
  id, brand_id, product_id, client_request_id, anonymous_token_hash, expires_at, upload_validated_at, person_storage_path
) VALUES (
  '55555555-5555-5555-5555-555555555555'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  '66666666-6666-6666-6666-666666666666',
  repeat('f', 64),
  now() + interval '1 day',
  now(),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/55555555-5555-5555-5555-555555555555/person.jpg'
);

SELECT throws_ok(
  $$
    SELECT * FROM public.queue_try_on_session('55555555-5555-5555-5555-555555555555'::uuid)
  $$,
  'P0001',
  NULL,
  'queue rejects inactive product'
);

UPDATE public.products SET is_active = true WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid;

SELECT lives_ok(
  $$
    SELECT * FROM public.queue_try_on_session('22222222-2222-2222-2222-222222222222'::uuid)
  $$,
  'valid queue succeeds'
);

SELECT is(
  (
    SELECT g.was_created
    FROM public.queue_try_on_session('22222222-2222-2222-2222-222222222222'::uuid) AS g
  ),
  false,
  'queue retry is idempotent'
);

SELECT is(
  (SELECT reserved_credits FROM public.brand_credit_balances WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1,
  'queue retry does not increase reserved credits again'
);

SELECT throws_ok(
  $$
    INSERT INTO public.credit_transactions (
      brand_id, type, amount, idempotency_key
    ) VALUES (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      'reserve'::public.credit_transaction_type,
      1,
      'reserve-without-session'
    )
  $$,
  '23514',
  NULL,
  'reserve transactions require session_id'
);

UPDATE public.try_on_sessions
SET status = 'processing'
WHERE id = '22222222-2222-2222-2222-222222222222'::uuid;

SELECT throws_ok(
  $$
    SELECT * FROM public.consume_reserved_brand_credits('22222222-2222-2222-2222-222222222222'::uuid)
  $$,
  '22023',
  NULL,
  'consume rejects session without result_storage_path'
);

UPDATE public.try_on_sessions
SET result_storage_path = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/22222222-2222-2222-2222-222222222222/result.png'
WHERE id = '22222222-2222-2222-2222-222222222222'::uuid;

SELECT lives_ok(
  $$
    SELECT * FROM public.consume_reserved_brand_credits('22222222-2222-2222-2222-222222222222'::uuid)
  $$,
  'consume succeeds when result path is present'
);

SELECT is(
  (SELECT consumed_credits FROM public.brand_credit_balances WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1,
  'consume increases consumed credits by stored cost'
);

SELECT is(
  (SELECT reserved_credits FROM public.brand_credit_balances WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  0,
  'consume decreases reserved credits by stored cost'
);

SELECT ok(
  (SELECT completed_at IS NOT NULL FROM public.try_on_sessions WHERE id = '22222222-2222-2222-2222-222222222222'::uuid),
  'consume sets completed_at'
);

SELECT ok(
  (SELECT expires_at <= now() + interval '25 hours'
   FROM public.try_on_sessions
   WHERE id = '22222222-2222-2222-2222-222222222222'::uuid),
  'completed session without consent expires within 24 hours'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.credit_transactions WHERE session_id = '22222222-2222-2222-2222-222222222222'::uuid AND type = 'consume'::public.credit_transaction_type),
  1::bigint,
  'consume creates exactly one consume transaction'
);

SELECT is(
  (SELECT g.was_created FROM public.consume_reserved_brand_credits('22222222-2222-2222-2222-222222222222'::uuid) AS g),
  false,
  'consume retry is idempotent'
);

INSERT INTO public.try_on_sessions (
  id, brand_id, product_id, client_request_id, anonymous_token_hash, expires_at, upload_validated_at, person_storage_path
) VALUES (
  '77777777-7777-7777-7777-777777777777'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  '88888888-8888-8888-8888-888888888888',
  repeat('1', 64),
  now() + interval '1 day',
  now(),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/77777777-7777-7777-7777-777777777777/person.jpg'
);

SELECT lives_ok(
  $$ SELECT * FROM public.queue_try_on_session('77777777-7777-7777-7777-777777777777'::uuid) $$,
  'queue second session for release counters test'
);

SELECT lives_ok(
  $$ SELECT * FROM public.release_reserved_brand_credits('77777777-7777-7777-7777-777777777777'::uuid) $$,
  'release succeeds for queued session'
);

SELECT is(
  (SELECT consumed_credits FROM public.brand_credit_balances WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1,
  'release does not increase consumed credits'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.credit_transactions WHERE session_id = '77777777-7777-7777-7777-777777777777'::uuid AND type = 'release'::public.credit_transaction_type),
  1::bigint,
  'release creates exactly one release transaction'
);

SELECT is(
  (SELECT g.was_created FROM public.release_reserved_brand_credits('77777777-7777-7777-7777-777777777777'::uuid) AS g),
  false,
  'release retry is idempotent'
);

SELECT throws_ok(
  $$ SELECT * FROM public.release_reserved_brand_credits('22222222-2222-2222-2222-222222222222'::uuid) $$,
  '22023',
  NULL,
  'completed session cannot release credits'
);

INSERT INTO public.try_on_sessions (
  id, brand_id, product_id, status, client_request_id, anonymous_token_hash, expires_at, upload_validated_at, credit_cost, person_storage_path
) VALUES (
  '99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'cancelled'::public.try_on_session_status,
  'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  repeat('2', 64),
  now() + interval '1 day',
  now(),
  1,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa/person.jpg'
);

UPDATE public.brand_credit_balances
SET reserved_credits = reserved_credits + 1
WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

INSERT INTO public.credit_transactions (brand_id, type, amount, idempotency_key, session_id)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'reserve'::public.credit_transaction_type,
  1,
  'session:99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa:reserve',
  '99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
);

SELECT lives_ok(
  $$ SELECT * FROM public.release_reserved_brand_credits('99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid) $$,
  'release succeeds for cancelled session with reserved credits'
);

SELECT is(
  (SELECT status::text FROM public.try_on_sessions WHERE id = '99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'cancelled',
  'release preserves cancelled status'
);

INSERT INTO public.try_on_sessions (
  id, brand_id, product_id, status, client_request_id, anonymous_token_hash, expires_at
) VALUES (
  'aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'cancelled'::public.try_on_session_status,
  'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  repeat('3', 64),
  now() + interval '1 day'
);

SELECT lives_ok(
  $$ SELECT * FROM public.release_reserved_brand_credits('aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid) $$,
  'release succeeds for cancelled session before queue'
);

SELECT is(
  (SELECT status::text FROM public.try_on_sessions WHERE id = 'aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'cancelled',
  'cancelled before queue remains cancelled after release'
);

SELECT throws_ok(
  $$ UPDATE public.try_on_sessions SET brand_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid WHERE id = '22222222-2222-2222-2222-222222222222'::uuid $$,
  '42501', NULL, 'brand_id is immutable'
);

SELECT throws_ok(
  $$ UPDATE public.try_on_sessions SET product_id = '99999999-9999-9999-9999-999999999999'::uuid WHERE id = '22222222-2222-2222-2222-222222222222'::uuid $$,
  '42501', NULL, 'product_id is immutable'
);

SELECT throws_ok(
  $$ UPDATE public.try_on_sessions SET client_request_id = '99999999-9999-9999-9999-999999999999' WHERE id = '22222222-2222-2222-2222-222222222222'::uuid $$,
  '42501', NULL, 'client_request_id is immutable'
);

SELECT ok(
  public.is_valid_customer_upload_path('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/person.webp'),
  'valid customer upload path passes validation'
);

SELECT ok(
  NOT public.is_valid_customer_upload_path('bad/path/person.svg'),
  'invalid customer upload path is rejected'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'customer-uploads' AND file_size_limit = 8388608
  ),
  'customer-uploads enforces 8 MB limit'
);

SELECT * FROM finish();

ROLLBACK;
