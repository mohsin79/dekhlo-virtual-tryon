BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(25);

SELECT has_function(
  'public',
  'admin_grant_brand_credits',
  ARRAY['uuid', 'integer', 'text', 'text', 'uuid'],
  'admin_grant_brand_credits exists'
);

SELECT has_function(
  'public',
  'admin_revoke_brand_credits',
  ARRAY['uuid', 'integer', 'text', 'text', 'uuid'],
  'admin_revoke_brand_credits exists'
);

SELECT function_privs_are(
  'public',
  'admin_grant_brand_credits',
  ARRAY['uuid', 'integer', 'text', 'text', 'uuid'],
  'authenticated',
  ARRAY[]::text[],
  'authenticated cannot execute admin_grant_brand_credits'
);

SELECT function_privs_are(
  'public',
  'admin_revoke_brand_credits',
  ARRAY['uuid', 'integer', 'text', 'text', 'uuid'],
  'authenticated',
  ARRAY[]::text[],
  'authenticated cannot execute admin_revoke_brand_credits'
);

SELECT tests.create_auth_user(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'platform-admin@test.local',
  'Platform Admin'
);

SELECT tests.create_auth_user(
  '22222222-2222-2222-2222-222222222222'::uuid,
  'not-admin@test.local',
  'Not Admin'
);

SELECT tests.seed_brand(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Brand A',
  'brand-a',
  '11111111-1111-1111-1111-111111111111'::uuid
);

SET LOCAL role service_role;
SELECT tests.assign_platform_admin('11111111-1111-1111-1111-111111111111'::uuid);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.admin_grant_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      10,
      'admin-grant-missing-actor',
      'Trial adjustment',
      NULL::uuid
    )
  $$,
  '22023',
  NULL,
  'admin grant rejects missing actor'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.admin_grant_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      10,
      'admin-grant-non-admin-actor',
      'Trial adjustment',
      '22222222-2222-2222-2222-222222222222'::uuid
    )
  $$,
  '42501',
  NULL,
  'admin grant rejects non-platform actor'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.admin_grant_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      10,
      'admin-grant-blank-reason',
      '   ',
      '11111111-1111-1111-1111-111111111111'::uuid
    )
  $$,
  '22023',
  NULL,
  'admin grant rejects blank reason'
);

SELECT is(
  (
    SELECT granted_credits
    FROM public.admin_grant_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      25,
      'admin-grant-success',
      'Initial platform grant',
      '11111111-1111-1111-1111-111111111111'::uuid
    )
  ),
  25,
  'admin grant increases granted_credits'
);

SELECT is(
  (
    SELECT was_created
    FROM public.admin_grant_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      25,
      'admin-grant-success',
      'Initial platform grant',
      '11111111-1111-1111-1111-111111111111'::uuid
    )
  ),
  false,
  'admin grant replay returns was_created false'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.credit_transactions WHERE idempotency_key = 'admin-grant-success'),
  1::bigint,
  'admin grant creates exactly one credit transaction'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.audit_logs WHERE idempotency_key = 'admin-grant-success'),
  1::bigint,
  'admin grant creates exactly one audit log'
);

SELECT is(
  (
    SELECT type::text
    FROM public.credit_transactions
    WHERE idempotency_key = 'admin-grant-success'
  ),
  'admin_grant',
  'admin grant transaction type is admin_grant'
);

SELECT is(
  (
    SELECT action
    FROM public.audit_logs
    WHERE idempotency_key = 'admin-grant-success'
  ),
  'credit.admin_grant',
  'admin grant audit action is credit.admin_grant'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.admin_grant_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      99,
      'admin-grant-success',
      'Different reason',
      '11111111-1111-1111-1111-111111111111'::uuid
    )
  $$,
  '23505',
  NULL,
  'admin grant idempotency conflict on mismatched reason'
);

SELECT is(
  (
    SELECT granted_credits
    FROM public.brand_credit_balances
    WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
  ),
  25,
  'admin grant conflict does not double the balance'
);

SELECT is(
  (
    SELECT granted_credits
    FROM public.admin_revoke_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      5,
      'admin-revoke-success',
      'Remove unused trial credits',
      '11111111-1111-1111-1111-111111111111'::uuid
    )
  ),
  20,
  'admin revoke decreases granted_credits'
);

SELECT is(
  (
    SELECT type::text
    FROM public.credit_transactions
    WHERE idempotency_key = 'admin-revoke-success'
  ),
  'admin_revoke',
  'admin revoke transaction type is admin_revoke'
);

SELECT is(
  (
    SELECT was_created
    FROM public.admin_revoke_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      5,
      'admin-revoke-success',
      'Remove unused trial credits',
      '11111111-1111-1111-1111-111111111111'::uuid
    )
  ),
  false,
  'admin revoke replay is idempotent'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.admin_revoke_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      100,
      'admin-revoke-too-much',
      'Over revoke',
      '11111111-1111-1111-1111-111111111111'::uuid
    )
  $$,
  '22023',
  NULL,
  'admin revoke rejects amount exceeding revocable granted credits'
);

SELECT is(
  (
    SELECT granted_credits
    FROM public.brand_credit_balances
    WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
  ),
  20,
  'failed admin revoke leaves balance unchanged'
);

SELECT is(
  (
    SELECT granted_credits
    FROM public.grant_brand_credits(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      3,
      'phase5-grant-regression',
      '{}'::jsonb
    )
  ),
  23,
  'grant_brand_credits regression still works after admin operations'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'credit_transactions_non_session_types_no_session_chk'
  ),
  'non-session credit types constraint exists'
);

SELECT ok(
  (
    SELECT count(*)::bigint
    FROM public.credit_transactions
    WHERE type = 'admin_grant'::public.credit_transaction_type
      AND session_id IS NOT NULL
  ) = 0,
  'admin_grant transactions have null session_id'
);

SELECT ok(
  (
    SELECT count(*)::bigint
    FROM public.credit_transactions
    WHERE type = 'admin_revoke'::public.credit_transaction_type
      AND session_id IS NOT NULL
  ) = 0,
  'admin_revoke transactions have null session_id'
);

SELECT throws_ok(
  $$
    UPDATE public.credit_transactions
    SET amount = 1
    WHERE idempotency_key = 'admin-grant-success'
  $$,
  '42501',
  NULL,
  'credit transactions remain append-only'
);

SELECT * FROM finish();

ROLLBACK;
