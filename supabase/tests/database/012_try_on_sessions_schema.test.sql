BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(22);

SELECT has_table('public', 'try_on_sessions', 'try_on_sessions exists');

SELECT is(
  (
    SELECT array_agg(enumlabel ORDER BY enumsortorder)::text[]
    FROM pg_enum
    JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
    WHERE pg_type.typname = 'try_on_session_status'
  ),
  ARRAY['pending_upload', 'queued', 'processing', 'completed', 'failed', 'cancelled']::text[],
  'try_on_session_status enum values are exact'
);

SELECT has_column('public', 'credit_transactions', 'session_id', 'credit_transactions.session_id exists');

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'try_on_sessions'
  ),
  'RLS enabled on try_on_sessions'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'try_on_sessions'
      AND cmd = 'ALL'
  ),
  0::bigint,
  'try_on_sessions has no FOR ALL policies'
);

SELECT is(
  public.try_on_v1_credit_cost(),
  1,
  'V1 credit cost constant is 1'
);

SELECT tests.create_auth_user('11111111-1111-1111-1111-111111111111'::uuid, 'owner-a@test.local', 'Owner A');

SELECT tests.seed_brand(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Brand A',
  'brand-a',
  '11111111-1111-1111-1111-111111111111'::uuid
);

INSERT INTO public.products (
  id,
  brand_id,
  name,
  slug,
  product_image_path,
  is_active
)
VALUES (
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
  person_storage_path
)
VALUES (
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  repeat('a', 64),
  now() + interval '1 day',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee/person.jpg'
);

SELECT is(
  (
    SELECT status::text
    FROM public.try_on_sessions
    WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid
  ),
  'pending_upload',
  'new session defaults to pending_upload'
);

SELECT throws_ok(
  $$
    UPDATE public.try_on_sessions
    SET credit_cost = 2
    WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid
  $$,
  '23514',
  NULL,
  'pending_upload cannot have positive credit_cost'
);

UPDATE public.try_on_sessions
SET upload_validated_at = now()
WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid;

SET LOCAL role service_role;

SELECT lives_ok(
  $$
    SELECT *
    FROM public.grant_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      5,
      'phase6-seed-grant',
      '{"source":"pgtap"}'::jsonb
    )
  $$,
  'seed brand credits for queue test'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.queue_try_on_session('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid)
  $$,
  'queue succeeds after validated upload'
);

SELECT is(
  (
    SELECT credit_cost
    FROM public.try_on_sessions
    WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid
  ),
  1,
  'queue stores credit_cost = 1'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.credit_transactions
    WHERE session_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid
      AND type = 'reserve'::public.credit_transaction_type
  ),
  1::bigint,
  'queue creates one reserve transaction'
);

SELECT is(
  (
    SELECT g.was_created
    FROM public.queue_try_on_session('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid) AS g
  ),
  false,
  'queue retry is idempotent'
);

SELECT throws_ok(
  $$
    UPDATE public.try_on_sessions
    SET credit_cost = 2
    WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid
  $$,
  '42501',
  NULL,
  'credit_cost is immutable after queue'
);

UPDATE public.try_on_sessions
SET
  status = 'processing',
  result_storage_path = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee/result.png'
WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid;

SELECT lives_ok(
  $$
    SELECT *
    FROM public.consume_reserved_brand_credits('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid)
  $$,
  'consume succeeds with stored credit_cost'
);

SELECT is(
  (
    SELECT status::text
    FROM public.try_on_sessions
    WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid
  ),
  'completed',
  'consume marks session completed'
);

INSERT INTO public.try_on_sessions (
  id,
  brand_id,
  product_id,
  client_request_id,
  anonymous_token_hash,
  expires_at,
  upload_validated_at,
  person_storage_path
)
VALUES (
  'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  repeat('b', 64),
  now() + interval '1 day',
  now(),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/ffffffff-ffff-ffff-ffff-ffffffffffff/person.jpg'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.queue_try_on_session('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
  $$,
  'second session queues for release test'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.release_reserved_brand_credits('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
  $$,
  'release succeeds for queued session'
);

SELECT is(
  (
    SELECT status::text
    FROM public.try_on_sessions
    WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid
  ),
  'failed',
  'release marks session failed'
);

SELECT throws_ok(
  $$
    INSERT INTO public.credit_transactions (
      brand_id,
      type,
      amount,
      idempotency_key,
      session_id
    )
    VALUES (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      'grant'::public.credit_transaction_type,
      1,
      'grant-with-session',
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid
    )
  $$,
  '23514',
  NULL,
  'grant transactions cannot use session_id'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'customer-uploads'
      AND public = false
  ),
  'customer-uploads bucket is private'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'try-on-results'
      AND public = false
  ),
  'try-on-results bucket is private'
);

SELECT * FROM finish();

ROLLBACK;
