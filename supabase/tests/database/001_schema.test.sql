BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(42);

SELECT has_table('public', 'profiles', 'profiles table exists');
SELECT has_table('public', 'brands', 'brands table exists');
SELECT has_table('public', 'brand_members', 'brand_members table exists');

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'id'
  ),
  'profiles.id exists'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'full_name'
  ),
  'profiles.full_name exists'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'avatar_path'
  ),
  'profiles.avatar_path exists'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'created_at'
  ),
  'profiles.created_at exists'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'updated_at'
  ),
  'profiles.updated_at exists'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'brands' AND column_name = 'id'
  ),
  'brands.id exists'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'brands' AND column_name = 'name'
  ),
  'brands.name exists'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'brands' AND column_name = 'slug'
  ),
  'brands.slug exists'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'brands' AND column_name = 'logo_path'
  ),
  'brands.logo_path exists'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'brands' AND column_name = 'plan'
  ),
  'brands.plan exists'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'brands' AND column_name = 'widget_config'
  ),
  'brands.widget_config exists'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'brand_members' AND column_name = 'brand_id'
  ),
  'brand_members.brand_id exists'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'brand_members' AND column_name = 'user_id'
  ),
  'brand_members.user_id exists'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'brand_members' AND column_name = 'role'
  ),
  'brand_members.role exists'
);

SELECT enum_has_labels(
  'public',
  'brand_role',
  ARRAY['owner', 'admin', 'editor', 'analyst'],
  'brand_role enum has canonical values'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'p'
  ),
  'profiles has a primary key on id'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.brand_members'::regclass
      AND contype = 'p'
  ),
  'brand_members has a composite primary key'
);

SELECT fk_ok(
  'public',
  'profiles',
  'id',
  'auth',
  'users',
  'id',
  'profiles.id references auth.users.id'
);
SELECT fk_ok(
  'public',
  'brand_members',
  'brand_id',
  'public',
  'brands',
  'id'
);
SELECT fk_ok(
  'public',
  'brand_members',
  'user_id',
  'public',
  'profiles',
  'id'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'brands'
      AND indexname = 'brands_slug_key'
  ),
  'brands slug unique index exists'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'brand_members'
      AND indexname = 'brand_members_user_id_idx'
  ),
  'brand_members user_id index exists'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'brand_members'
      AND indexname = 'brand_members_brand_id_idx'
  ),
  'brand_members brand_id index exists'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.profiles'::regclass),
  'RLS enabled on profiles'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.brands'::regclass),
  'RLS enabled on brands'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.brand_members'::regclass),
  'RLS enabled on brand_members'
);

SELECT policies_are(
  'public',
  'profiles',
  ARRAY['profiles_select_own', 'profiles_update_own', 'profiles_insert_own']
);
SELECT policies_are(
  'public',
  'brands',
  ARRAY['brands_select_members', 'brands_update_owner_admin', 'brands_delete_owner']
);
SELECT policies_are(
  'public',
  'brand_members',
  ARRAY[
    'brand_members_select_members',
    'brand_members_insert_owner_admin',
    'brand_members_update_owner',
    'brand_members_delete_owner_admin'
  ]
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_select_own'
      AND cmd = 'SELECT'
  ),
  'profiles_select_own is a SELECT policy'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_update_own'
      AND cmd = 'UPDATE'
  ),
  'profiles_update_own is an UPDATE policy'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_insert_own'
      AND cmd = 'INSERT'
  ),
  'profiles_insert_own is an INSERT policy'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brands'
      AND policyname = 'brands_select_members'
      AND cmd = 'SELECT'
  ),
  'brands_select_members is a SELECT policy'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brands'
      AND policyname = 'brands_update_owner_admin'
      AND cmd = 'UPDATE'
  ),
  'brands_update_owner_admin is an UPDATE policy'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brands'
      AND policyname = 'brands_delete_owner'
      AND cmd = 'DELETE'
  ),
  'brands_delete_owner is a DELETE policy'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brand_members'
      AND policyname = 'brand_members_select_members'
      AND cmd = 'SELECT'
  ),
  'brand_members_select_members is a SELECT policy'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brand_members'
      AND policyname = 'brand_members_insert_owner_admin'
      AND cmd = 'INSERT'
  ),
  'brand_members_insert_owner_admin is an INSERT policy'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brand_members'
      AND policyname = 'brand_members_update_owner'
      AND cmd = 'UPDATE'
  ),
  'brand_members_update_owner is an UPDATE policy'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brand_members'
      AND policyname = 'brand_members_delete_owner_admin'
      AND cmd = 'DELETE'
  ),
  'brand_members_delete_owner_admin is a DELETE policy'
);

SELECT * FROM finish();

ROLLBACK;
