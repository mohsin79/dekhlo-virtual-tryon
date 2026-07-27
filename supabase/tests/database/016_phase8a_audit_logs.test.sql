BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(10);

SELECT has_table('public', 'audit_logs', 'audit_logs table exists');

SELECT col_is_pk('public', 'audit_logs', ARRAY['id'], 'audit_logs primary key exists');

SELECT has_index('public', 'audit_logs', 'audit_logs_idempotency_key_key', 'audit_logs idempotency unique index exists');

SELECT tests.create_auth_user(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'platform-admin@test.local',
  'Platform Admin'
);

SELECT tests.create_auth_user(
  '22222222-2222-2222-2222-222222222222'::uuid,
  'merchant@test.local',
  'Merchant'
);

SET LOCAL role service_role;
SELECT tests.assign_platform_admin('11111111-1111-1111-1111-111111111111'::uuid);

SELECT tests.set_jwt_claims('11111111-1111-1111-1111-111111111111'::uuid);
SET LOCAL role authenticated;

SELECT ok(
  (SELECT count(*) = 0 FROM public.audit_logs),
  'platform admin sees empty audit_logs initially'
);

SELECT tests.set_jwt_claims('22222222-2222-2222-2222-222222222222'::uuid);

SELECT ok(
  (SELECT count(*)::bigint FROM public.audit_logs) = 0,
  'non-platform authenticated user cannot read audit_logs rows'
);

SET LOCAL role anon;

SELECT throws_ok(
  $$ SELECT count(*) FROM public.audit_logs $$,
  '42501',
  NULL,
  'anon cannot select audit_logs'
);

SELECT tests.set_jwt_claims('11111111-1111-1111-1111-111111111111'::uuid);
SET LOCAL role authenticated;

SELECT throws_ok(
  $$
    INSERT INTO public.audit_logs (
      action,
      actor_user_id,
      reason,
      idempotency_key
    )
    VALUES (
      'credit.admin_grant',
      '11111111-1111-1111-1111-111111111111'::uuid,
      'direct insert',
      'audit-direct-insert'
    )
  $$,
  '42501',
  NULL,
  'authenticated direct insert into audit_logs is denied'
);

SET LOCAL role service_role;

SELECT tests.seed_brand(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  'Brand Audit',
  'brand-audit',
  '11111111-1111-1111-1111-111111111111'::uuid
);

SELECT audit_log_id
FROM public.admin_grant_brand_credits(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  1,
  'audit-immutability-row',
  'Seed audit row for immutability tests',
  '11111111-1111-1111-1111-111111111111'::uuid
);

SELECT throws_ok(
  $$
    UPDATE public.audit_logs
    SET reason = 'changed'
    WHERE idempotency_key = 'audit-immutability-row'
  $$,
  '42501',
  NULL,
  'audit_logs update is rejected'
);

SELECT throws_ok(
  $$
    DELETE FROM public.audit_logs
    WHERE idempotency_key = 'audit-immutability-row'
  $$,
  '42501',
  NULL,
  'audit_logs delete is rejected'
);

SELECT throws_ok(
  $$
    INSERT INTO public.audit_logs (
      action,
      actor_user_id,
      reason,
      idempotency_key,
      metadata
    )
    VALUES (
      'credit.admin_grant',
      '11111111-1111-1111-1111-111111111111'::uuid,
      'bad metadata',
      'audit-bad-metadata',
      '[]'::jsonb
    )
  $$,
  '23514',
  NULL,
  'audit_logs metadata must be a JSON object'
);

SELECT * FROM finish();

ROLLBACK;
