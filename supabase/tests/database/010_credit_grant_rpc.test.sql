BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(18);

SELECT has_function(
  'public',
  'grant_brand_credits',
  ARRAY['uuid', 'integer', 'text', 'jsonb'],
  'grant_brand_credits exists with expected signature'
);

SELECT ok(
  NOT pg_catalog.has_function_privilege(
    'public',
    'public.grant_brand_credits(uuid, integer, text, jsonb)',
    'EXECUTE'
  ),
  'PUBLIC cannot execute grant_brand_credits'
);

SELECT function_privs_are(
  'public',
  'grant_brand_credits',
  ARRAY['uuid', 'integer', 'text', 'jsonb'],
  'anon',
  ARRAY[]::text[],
  'anon cannot execute grant_brand_credits'
);

SELECT function_privs_are(
  'public',
  'grant_brand_credits',
  ARRAY['uuid', 'integer', 'text', 'jsonb'],
  'authenticated',
  ARRAY[]::text[],
  'authenticated cannot execute grant_brand_credits'
);

SELECT function_privs_are(
  'public',
  'grant_brand_credits',
  ARRAY['uuid', 'integer', 'text', 'jsonb'],
  'service_role',
  ARRAY['EXECUTE'],
  'service_role can execute grant_brand_credits'
);

SELECT tests.create_auth_user(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'owner-a@test.local',
  'Owner A'
);

SELECT tests.seed_brand(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Brand A',
  'brand-a',
  '11111111-1111-1111-1111-111111111111'::uuid
);

SET LOCAL role service_role;

SELECT throws_ok(
  $$
    SELECT *
    FROM public.grant_brand_credits(
      '00000000-0000-0000-0000-000000000000'::uuid,
      10,
      'missing-brand',
      '{}'::jsonb
    )
  $$,
  'P0001',
  NULL,
  'invalid brand is rejected'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.grant_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      0,
      'zero-amount',
      '{}'::jsonb
    )
  $$,
  '22023',
  NULL,
  'zero amount is rejected'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.grant_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      -5,
      'negative-amount',
      '{}'::jsonb
    )
  $$,
  '22023',
  NULL,
  'negative amount is rejected'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.grant_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      10,
      '   ',
      '{}'::jsonb
    )
  $$,
  '22023',
  NULL,
  'blank idempotency key is rejected'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.grant_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      10,
      'bad-metadata',
      '[]'::jsonb
    )
  $$,
  '22023',
  NULL,
  'non-object metadata is rejected'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.grant_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      25,
      'phase5-grant-1',
      '{"source":"pgtap"}'::jsonb
    )
  $$,
  'valid grant call succeeds'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.credit_transactions WHERE idempotency_key = 'phase5-grant-1'),
  1::bigint,
  'valid grant creates one transaction'
);

SELECT is(
  (
    SELECT granted_credits
    FROM public.brand_credit_balances
    WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
  ),
  25,
  'valid grant increments granted credits exactly once'
);

SELECT is(
  (
    SELECT g.available_credits
    FROM public.grant_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      25,
      'phase5-grant-1',
      '{"source":"pgtap-retry"}'::jsonb
    ) AS g
  ),
  25::integer,
  'retrying the same idempotency key returns prior result'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.credit_transactions WHERE idempotency_key = 'phase5-grant-1'),
  1::bigint,
  'retry does not create a second transaction'
);

SELECT is(
  (
    SELECT granted_credits
    FROM public.brand_credit_balances
    WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
  ),
  25,
  'retry does not increment granted credits again'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.grant_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      50,
      'phase5-grant-1',
      '{}'::jsonb
    )
  $$,
  '23505',
  NULL,
  'same key with different amount is rejected'
);

SELECT tests.create_auth_user(
  '22222222-2222-2222-2222-222222222222'::uuid,
  'owner-b@test.local',
  'Owner B'
);

SELECT tests.seed_brand(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  'Brand B',
  'brand-b',
  '22222222-2222-2222-2222-222222222222'::uuid
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.grant_brand_credits(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
      25,
      'phase5-grant-1',
      '{}'::jsonb
    )
  $$,
  '23505',
  NULL,
  'same key with different brand is rejected'
);

SELECT * FROM finish();

ROLLBACK;
