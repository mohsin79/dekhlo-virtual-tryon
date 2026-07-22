BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(7);

SELECT tests.create_auth_user(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'owner-a@test.local',
  'Owner A'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111'::uuid),
  1::bigint,
  'auth.users insert creates exactly one profile'
);

SELECT is(
  (SELECT full_name FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111'::uuid),
  'Owner A',
  'profile full_name comes from user metadata'
);

SELECT tests.create_auth_user(
  '22222222-2222-2222-2222-222222222222'::uuid,
  'no-meta@test.local',
  NULL
);

SELECT is(
  (SELECT full_name FROM public.profiles WHERE id = '22222222-2222-2222-2222-222222222222'::uuid),
  '',
  'missing metadata defaults full_name to empty string'
);

SELECT tests.create_auth_user(
  '44444444-4444-4444-4444-444444444444'::uuid,
  'cascade@test.local',
  'Cascade User'
);

DELETE FROM auth.users WHERE id = '44444444-4444-4444-4444-444444444444'::uuid;

SELECT is(
  (SELECT count(*)::bigint FROM public.profiles WHERE id = '44444444-4444-4444-4444-444444444444'::uuid),
  0::bigint,
  'deleting auth user cascades to profile'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'set_updated_at'
  ),
  'set_updated_at function exists'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'handle_new_user'
  ),
  'handle_new_user function exists'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'user_has_brand_role'
  ),
  'user_has_brand_role function exists'
);

SELECT * FROM finish();

ROLLBACK;
