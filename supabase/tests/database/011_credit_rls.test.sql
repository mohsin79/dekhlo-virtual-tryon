BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(13);

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

SET LOCAL role service_role;

SELECT *
FROM public.grant_brand_credits(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  40,
  'rls-grant-brand-a',
  '{"source":"pgtap"}'::jsonb
);

SELECT tests.set_jwt_claims('11111111-1111-1111-1111-111111111111'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (
    SELECT granted_credits
    FROM public.brand_credit_balances
    WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
  ),
  40,
  'owner can read brand balance'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.credit_transactions WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1::bigint,
  'owner can read brand transactions'
);

SELECT tests.set_jwt_claims('22222222-2222-2222-2222-222222222222'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (
    SELECT granted_credits
    FROM public.brand_credit_balances
    WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
  ),
  40,
  'admin can read brand balance'
);

SELECT tests.set_jwt_claims('44444444-4444-4444-4444-444444444444'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (
    SELECT granted_credits
    FROM public.brand_credit_balances
    WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
  ),
  40,
  'analyst can read brand balance'
);

SELECT tests.set_jwt_claims('33333333-3333-3333-3333-333333333333'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.brand_credit_balances WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  0::bigint,
  'editor cannot read credit balance'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.credit_transactions WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  0::bigint,
  'editor cannot read credit transactions'
);

SELECT tests.set_jwt_claims('55555555-5555-5555-5555-555555555555'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.brand_credit_balances WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  0::bigint,
  'unrelated user cannot read brand credit balance'
);

SELECT tests.set_jwt_claims('66666666-6666-6666-6666-666666666666'::uuid);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.brand_credit_balances WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  0::bigint,
  'other brand owner cannot read across tenants'
);

SELECT tests.clear_jwt_claims();
SET LOCAL role anon;

SELECT throws_ok(
  $$
    SELECT count(*)::bigint FROM public.brand_credit_balances
  $$,
  '42501',
  NULL,
  'anon cannot read credit balances'
);

SELECT tests.set_jwt_claims('11111111-1111-1111-1111-111111111111'::uuid);
SET LOCAL role authenticated;

SELECT throws_ok(
  $$
    UPDATE public.brand_credit_balances
    SET granted_credits = 999
    WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
  $$,
  '42501',
  NULL,
  'authenticated users cannot directly update balances'
);

SELECT throws_ok(
  $$
    INSERT INTO public.credit_transactions (brand_id, type, amount, idempotency_key)
    VALUES (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      'grant'::public.credit_transaction_type,
      10,
      'direct-insert'
    )
  $$,
  '42501',
  NULL,
  'authenticated users cannot directly insert transactions'
);

RESET role;

INSERT INTO public.credit_transactions (
  brand_id,
  type,
  amount,
  idempotency_key
)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'grant'::public.credit_transaction_type,
  10,
  'append-only-test'
);

SELECT throws_ok(
  $$
    UPDATE public.credit_transactions
    SET amount = 99
    WHERE idempotency_key = 'append-only-test'
  $$,
  '42501',
  NULL,
  'credit transactions cannot be updated'
);

SELECT throws_ok(
  $$
    DELETE FROM public.credit_transactions
    WHERE idempotency_key = 'append-only-test'
  $$,
  '42501',
  NULL,
  'credit transactions cannot be deleted'
);

SELECT * FROM finish();

ROLLBACK;
