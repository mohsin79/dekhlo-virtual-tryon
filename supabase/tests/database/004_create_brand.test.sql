BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(18);

SELECT has_function(
  'public',
  'create_brand_with_owner',
  ARRAY['text', 'text'],
  'create_brand_with_owner exists with expected signature'
);

SELECT ok(
  NOT pg_catalog.has_function_privilege(
    'public',
    'public.create_brand_with_owner(text, text)',
    'EXECUTE'
  ),
  'PUBLIC cannot execute create_brand_with_owner'
);

SELECT function_privs_are(
  'public',
  'create_brand_with_owner',
  ARRAY['text', 'text'],
  'anon',
  ARRAY[]::text[],
  'anon cannot execute create_brand_with_owner'
);

SELECT function_privs_are(
  'public',
  'create_brand_with_owner',
  ARRAY['text', 'text'],
  'authenticated',
  ARRAY['EXECUTE'],
  'authenticated can execute create_brand_with_owner'
);

SELECT tests.create_auth_user(
  '88888888-8888-8888-8888-888888888888'::uuid,
  'onboarding@test.local',
  'Onboarding User'
);
SELECT tests.create_auth_user(
  '99999999-9999-9999-9999-999999999999'::uuid,
  'other@test.local',
  'Other User'
);

SELECT tests.clear_jwt_claims();
SET LOCAL role authenticated;
SELECT throws_ok(
  $$ SELECT public.create_brand_with_owner('Valid Brand', 'valid-brand') $$,
  '42501',
  NULL,
  'unauthenticated execution is rejected'
);
RESET role;

SELECT tests.set_jwt_claims('88888888-8888-8888-8888-888888888888'::uuid);
SET LOCAL role authenticated;

SELECT public.create_brand_with_owner('Phase 3 Brand', 'phase3-brand');

SELECT is(
  (SELECT count(*)::bigint FROM public.brands WHERE slug = 'phase3-brand'),
  1::bigint,
  'valid authenticated call creates exactly one brand'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.brand_members bm
    JOIN public.brands b ON b.id = bm.brand_id
    WHERE b.slug = 'phase3-brand'
  ),
  1::bigint,
  'valid authenticated call creates exactly one owner membership'
);

SELECT is(
  (
    SELECT bm.user_id
    FROM public.brand_members bm
    JOIN public.brands b ON b.id = bm.brand_id
    WHERE b.slug = 'phase3-brand'
  ),
  '88888888-8888-8888-8888-888888888888'::uuid,
  'membership user_id equals auth.uid()'
);

SELECT is(
  (
    SELECT bm.role::text
    FROM public.brand_members bm
    JOIN public.brands b ON b.id = bm.brand_id
    WHERE b.slug = 'phase3-brand'
  ),
  'owner',
  'membership role is exactly owner'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_brand_with_owner'
      AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_name text, p_slug text'
  ),
  1,
  'create_brand_with_owner does not accept a caller-supplied owner ID'
);

SELECT throws_ok(
  $$ SELECT public.create_brand_with_owner('   ', 'valid-slug') $$,
  '22023',
  NULL,
  'invalid brand names are rejected'
);

SELECT throws_ok(
  $$ SELECT public.create_brand_with_owner('Valid Name', 'Invalid_Slug') $$,
  '22023',
  NULL,
  'invalid slugs are rejected'
);

SELECT throws_ok(
  $$ SELECT public.create_brand_with_owner('Duplicate Brand', 'phase3-brand') $$,
  '23505',
  NULL,
  'duplicate slugs are rejected'
);

SELECT throws_ok(
  $$ SELECT public.create_brand_with_owner('Failed Brand', 'failed-brand!') $$,
  '22023',
  NULL,
  'invalid slug attempt is rejected before writes'
);

SELECT ok(
  (SELECT count(*)::bigint FROM public.brands WHERE slug = 'failed-brand') = 0
  AND (
    SELECT count(*)::bigint
    FROM public.brand_members bm
    JOIN public.brands b ON b.id = bm.brand_id
    WHERE b.slug = 'failed-brand'
  ) = 0,
  'failed request creates neither a brand nor a membership'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profiles', 'brands', 'brand_members')
  ),
  10::bigint,
  'existing RLS policies remain unchanged'
);

SELECT throws_ok(
  $$
    INSERT INTO public.brands (name, slug)
    VALUES ('Direct Brand', 'direct-brand')
  $$,
  '42501',
  NULL,
  'direct authenticated INSERT into brands remains unavailable'
);

SELECT tests.set_jwt_claims('99999999-9999-9999-9999-999999999999'::uuid);
SET LOCAL role authenticated;
SELECT is(
  (SELECT count(*)::bigint FROM public.brands WHERE slug = 'phase3-brand'),
  0::bigint,
  'cross-tenant access remains denied'
);

SELECT * FROM finish();

ROLLBACK;
