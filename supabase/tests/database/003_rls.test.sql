BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(24);

SELECT tests.create_auth_user('11111111-1111-1111-1111-111111111111'::uuid, 'owner-a@test.local', 'Owner A');
SELECT tests.create_auth_user('22222222-2222-2222-2222-222222222222'::uuid, 'admin-a@test.local', 'Admin A');
SELECT tests.create_auth_user('33333333-3333-3333-3333-333333333333'::uuid, 'editor-a@test.local', 'Editor A');
SELECT tests.create_auth_user('44444444-4444-4444-4444-444444444444'::uuid, 'analyst-a@test.local', 'Analyst A');
SELECT tests.create_auth_user('55555555-5555-5555-5555-555555555555'::uuid, 'unrelated@test.local', 'Unrelated');
SELECT tests.create_auth_user('66666666-6666-6666-6666-666666666666'::uuid, 'owner-b@test.local', 'Owner B');
SELECT tests.create_auth_user('77777777-7777-7777-7777-777777777777'::uuid, 'invitee@test.local', 'Invitee');

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

SELECT tests.clear_jwt_claims();
SET LOCAL role anon;
SELECT throws_ok(
  $$ SELECT count(*)::bigint FROM public.brands $$,
  '42501',
  NULL,
  'anon cannot read brands'
);
SELECT throws_ok(
  $$ SELECT count(*)::bigint FROM public.brand_members $$,
  '42501',
  NULL,
  'anon cannot read brand memberships'
);
SELECT throws_ok(
  $$ SELECT count(*)::bigint FROM public.profiles $$,
  '42501',
  NULL,
  'anon cannot read profiles'
);
RESET role;

SELECT tests.set_jwt_claims('55555555-5555-5555-5555-555555555555'::uuid);
SET LOCAL role authenticated;
SELECT is(
  (SELECT count(*)::bigint FROM public.brands WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  0::bigint,
  'unrelated user cannot read brand A'
);
SELECT is(
  (SELECT count(*)::bigint FROM public.brand_members WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  0::bigint,
  'unrelated user cannot enumerate brand A memberships'
);

SELECT tests.set_jwt_claims('11111111-1111-1111-1111-111111111111'::uuid);
SET LOCAL role authenticated;
SELECT is(
  (SELECT count(*)::bigint FROM public.brands WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1::bigint,
  'owner can read own brand'
);
SELECT is(
  (SELECT count(*)::bigint FROM public.brand_members WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  4::bigint,
  'owner can read brand memberships'
);

UPDATE public.brands
SET name = 'Brand A Updated'
WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

SELECT is(
  (SELECT name FROM public.brands WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'Brand A Updated',
  'owner can update brand settings'
);
SELECT is(
  (SELECT full_name FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111'::uuid),
  'Owner A',
  'owner can read own profile'
);

UPDATE public.profiles
SET full_name = 'Owner A Updated'
WHERE id = '11111111-1111-1111-1111-111111111111'::uuid;

SELECT is(
  (SELECT full_name FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111'::uuid),
  'Owner A Updated',
  'owner can update own profile'
);

SELECT tests.set_jwt_claims('22222222-2222-2222-2222-222222222222'::uuid);
SET LOCAL role authenticated;
SELECT is(
  (SELECT count(*)::bigint FROM public.brands WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1::bigint,
  'admin can read brand'
);

UPDATE public.brands
SET widget_config = '{"theme":"dark"}'::jsonb
WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

SELECT is(
  (SELECT widget_config FROM public.brands WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  '{"theme":"dark"}'::jsonb,
  'admin can update brand settings'
);

INSERT INTO public.brand_members (brand_id, user_id, role)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  '77777777-7777-7777-7777-777777777777'::uuid,
  'analyst'::public.brand_role
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.brand_members
    WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
      AND user_id = '77777777-7777-7777-7777-777777777777'::uuid
  ),
  1::bigint,
  'admin can invite a member with allowed role'
);

SELECT tests.set_jwt_claims('33333333-3333-3333-3333-333333333333'::uuid);
SET LOCAL role authenticated;
SELECT is(
  (SELECT count(*)::bigint FROM public.brands WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1::bigint,
  'editor can read brand'
);

UPDATE public.brands
SET name = 'Editor Hack'
WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

SELECT is(
  (SELECT name FROM public.brands WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'Brand A Updated',
  'editor cannot update brand settings'
);

SELECT tests.set_jwt_claims('44444444-4444-4444-4444-444444444444'::uuid);
SET LOCAL role authenticated;
SELECT is(
  (SELECT count(*)::bigint FROM public.brands WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1::bigint,
  'analyst can read brand'
);

SELECT throws_ok(
  $$
    INSERT INTO public.brand_members (brand_id, user_id, role)
    VALUES (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      '77777777-7777-7777-7777-777777777777'::uuid,
      'editor'::public.brand_role
    )
  $$,
  '42501',
  NULL,
  'analyst cannot invite members'
);

SELECT tests.set_jwt_claims('55555555-5555-5555-5555-555555555555'::uuid);
SET LOCAL role authenticated;

UPDATE public.profiles
SET full_name = 'Hacked'
WHERE id = '11111111-1111-1111-1111-111111111111'::uuid;

SELECT tests.set_jwt_claims('11111111-1111-1111-1111-111111111111'::uuid);
SET LOCAL role authenticated;
SELECT is(
  (SELECT full_name FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111'::uuid),
  'Owner A Updated',
  'user cannot update another users profile'
);

SELECT tests.set_jwt_claims('55555555-5555-5555-5555-555555555555'::uuid);
SET LOCAL role authenticated;

SELECT throws_ok(
  $$
    INSERT INTO public.brands (name, slug)
    VALUES ('Orphan Brand', 'orphan-brand')
  $$,
  '42501',
  NULL,
  'authenticated users cannot create ownerless brands directly'
);

SELECT tests.set_jwt_claims('22222222-2222-2222-2222-222222222222'::uuid);
SET LOCAL role authenticated;

UPDATE public.brand_members
SET role = 'owner'::public.brand_role
WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
  AND user_id = '22222222-2222-2222-2222-222222222222'::uuid;

SELECT is(
  (
    SELECT role::text
    FROM public.brand_members
    WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
      AND user_id = '22222222-2222-2222-2222-222222222222'::uuid
  ),
  'admin',
  'admin cannot self-promote to owner'
);

SELECT throws_ok(
  $$
    INSERT INTO public.brand_members (brand_id, user_id, role)
    VALUES (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      '22222222-2222-2222-2222-222222222222'::uuid,
      'admin'::public.brand_role
    )
  $$,
  '42501',
  NULL,
  'admin cannot insert duplicate membership row for self'
);

SELECT tests.set_jwt_claims('11111111-1111-1111-1111-111111111111'::uuid);
SET LOCAL role authenticated;

DELETE FROM public.brand_members
WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
  AND user_id = '11111111-1111-1111-1111-111111111111'::uuid;

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.brand_members
    WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
      AND user_id = '11111111-1111-1111-1111-111111111111'::uuid
      AND role = 'owner'::public.brand_role
  ),
  1::bigint,
  'owner membership row cannot be removed by owner via client policy'
);

SELECT throws_ok(
  $$
    INSERT INTO public.brand_members (brand_id, user_id, role)
    VALUES (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      '55555555-5555-5555-5555-555555555555'::uuid,
      'owner'::public.brand_role
    )
  $$,
  '42501',
  NULL,
  'owner role cannot be granted through client insert'
);

SELECT tests.set_jwt_claims('66666666-6666-6666-6666-666666666666'::uuid);
SET LOCAL role authenticated;
SELECT is(
  (SELECT count(*)::bigint FROM public.brands WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  0::bigint,
  'brand B owner cannot read brand A'
);

SELECT * FROM finish();

ROLLBACK;
