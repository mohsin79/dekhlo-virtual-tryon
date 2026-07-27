BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(11);

SELECT has_enum('public', 'platform_role', 'platform_role enum exists');
SELECT enum_has_labels(
  'public',
  'platform_role',
  ARRAY['platform_admin'],
  'platform_role has platform_admin label'
);

SELECT has_column('public', 'profiles', 'platform_role', 'profiles.platform_role exists');

SELECT tests.create_auth_user(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'owner-a@test.local',
  'Owner A'
);

SELECT tests.create_auth_user(
  '22222222-2222-2222-2222-222222222222'::uuid,
  'user-b@test.local',
  'User B'
);

SELECT tests.seed_brand(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Brand A',
  'brand-a',
  '11111111-1111-1111-1111-111111111111'::uuid
);

SELECT tests.add_member(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  'admin'::public.brand_role
);

SELECT tests.set_jwt_claims('11111111-1111-1111-1111-111111111111'::uuid);
SET LOCAL role authenticated;

SELECT throws_ok(
  $$
    UPDATE public.profiles
    SET platform_role = 'platform_admin'::public.platform_role
    WHERE id = '11111111-1111-1111-1111-111111111111'::uuid
  $$,
  '42501',
  NULL,
  'authenticated user cannot self-assign platform_role'
);

SELECT tests.clear_jwt_claims();
SET LOCAL role service_role;

SELECT tests.assign_platform_admin('11111111-1111-1111-1111-111111111111'::uuid);

SELECT is(
  (
    SELECT platform_role::text
    FROM public.profiles
    WHERE id = '11111111-1111-1111-1111-111111111111'::uuid
  ),
  'platform_admin',
  'service_role bootstrap assigns platform_admin'
);

SELECT tests.set_jwt_claims('22222222-2222-2222-2222-222222222222'::uuid);
SET LOCAL role authenticated;

SELECT ok(
  NOT public.is_platform_admin('22222222-2222-2222-2222-222222222222'::uuid),
  'brand admin member is not a platform admin'
);

SELECT tests.set_jwt_claims('11111111-1111-1111-1111-111111111111'::uuid);

SELECT ok(
  public.is_platform_admin('11111111-1111-1111-1111-111111111111'::uuid),
  'platform admin profile returns true from is_platform_admin'
);

SELECT ok(
  NOT public.is_platform_admin(NULL::uuid),
  'is_platform_admin returns false for null user id'
);

SELECT ok(
  NOT public.is_platform_admin('99999999-9999-9999-9999-999999999999'::uuid),
  'is_platform_admin returns false for missing profile'
);

SELECT function_privs_are(
  'public',
  'is_platform_admin',
  ARRAY['uuid'],
  'anon',
  ARRAY[]::text[],
  'anon cannot execute is_platform_admin'
);

SELECT function_privs_are(
  'public',
  'is_platform_admin',
  ARRAY['uuid'],
  'authenticated',
  ARRAY['EXECUTE'],
  'authenticated can execute is_platform_admin'
);

SELECT * FROM finish();

ROLLBACK;
