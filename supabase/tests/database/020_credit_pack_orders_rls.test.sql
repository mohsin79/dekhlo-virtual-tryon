BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(8);

SELECT tests.create_auth_user('11111111-1111-1111-1111-111111111111'::uuid, 'owner-a@test.local', 'Owner A');
SELECT tests.create_auth_user('22222222-2222-2222-2222-222222222222'::uuid, 'admin-a@test.local', 'Admin A');
SELECT tests.create_auth_user('33333333-3333-3333-3333-333333333333'::uuid, 'editor-a@test.local', 'Editor A');
SELECT tests.create_auth_user('44444444-4444-4444-4444-444444444444'::uuid, 'analyst-a@test.local', 'Analyst A');
SELECT tests.create_auth_user('55555555-5555-5555-5555-555555555555'::uuid, 'owner-b@test.local', 'Owner B');

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
  '55555555-5555-5555-5555-555555555555'::uuid
);

SET LOCAL role service_role;

INSERT INTO public.credit_pack_orders (
  id,
  brand_id,
  pack_id,
  credits,
  amount_paisa,
  currency,
  provider,
  provider_environment,
  status,
  credit_idempotency_key
)
VALUES (
  'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'starter',
  25,
  250000,
  'PKR',
  'safepay',
  'sandbox',
  'pending',
  'credit-pack:cccccccc-cccc-cccc-cccc-cccccccccccc'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.credit_pack_orders
  ),
  1,
  'service role can insert a credit pack order'
);

SELECT tests.set_jwt_claims('11111111-1111-1111-1111-111111111111'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.credit_pack_orders
  ),
  1,
  'owner can read their brand credit pack order'
);

SELECT tests.set_jwt_claims('44444444-4444-4444-4444-444444444444'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.credit_pack_orders
  ),
  1,
  'analyst can read their brand credit pack order'
);

SELECT tests.set_jwt_claims('33333333-3333-3333-3333-333333333333'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.credit_pack_orders
  ),
  0,
  'editor cannot read credit pack orders'
);

SELECT tests.set_jwt_claims('55555555-5555-5555-5555-555555555555'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.credit_pack_orders
  ),
  0,
  'another brand owner cannot read the order'
);

SELECT throws_ok(
  $$
    INSERT INTO public.credit_pack_orders (
      brand_id,
      pack_id,
      credits,
      amount_paisa,
      provider,
      provider_environment,
      credit_idempotency_key
    )
    VALUES (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      'starter',
      25,
      250000,
      'safepay',
      'sandbox',
      'credit-pack:should-fail'
    )
  $$,
  '42501',
  NULL,
  'authenticated cannot insert credit pack orders'
);

SELECT throws_ok(
  $$
    UPDATE public.credit_pack_orders
    SET status = 'paid'
    WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid
  $$,
  '42501',
  NULL,
  'authenticated cannot update credit pack orders'
);

RESET role;
SELECT tests.clear_jwt_claims();

SELECT is(
  (
    SELECT status
    FROM public.credit_pack_orders
    WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid
  ),
  'pending',
  'failed authenticated update left the order pending'
);

SELECT * FROM finish();
ROLLBACK;
