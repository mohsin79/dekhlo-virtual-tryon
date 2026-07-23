BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(21);

SELECT has_table('public', 'products', 'public.products exists');

SELECT has_column('public', 'products', 'id', 'products.id exists');
SELECT has_column('public', 'products', 'brand_id', 'products.brand_id exists');
SELECT has_column('public', 'products', 'name', 'products.name exists');
SELECT has_column('public', 'products', 'slug', 'products.slug exists');
SELECT has_column('public', 'products', 'product_image_path', 'products.product_image_path exists');
SELECT has_column('public', 'products', 'category', 'products.category exists');
SELECT has_column('public', 'products', 'is_active', 'products.is_active exists');
SELECT has_column('public', 'products', 'metadata', 'products.metadata exists');
SELECT has_column('public', 'products', 'created_at', 'products.created_at exists');
SELECT has_column('public', 'products', 'updated_at', 'products.updated_at exists');

SELECT col_is_pk('public', 'products', ARRAY['id'], 'products primary key exists');

SELECT fk_ok(
  'public',
  'products',
  ARRAY['brand_id'],
  'public',
  'brands',
  ARRAY['id'],
  'products brand foreign key exists'
);

SELECT ok(
  (
    SELECT confdeltype
    FROM pg_constraint
    WHERE conname = 'products_brand_id_fkey'
  ) = 'c',
  'products brand foreign key cascades on brand delete'
);

SELECT has_index('public', 'products', 'products_brand_slug_key', 'products brand slug unique index exists');
SELECT has_index('public', 'products', 'products_brand_id_idx', 'products brand id index exists');
SELECT has_index('public', 'products', 'products_brand_active_idx', 'products brand active index exists');

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'products_set_updated_at'
  ),
  'products updated_at trigger exists'
);

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'products'
  ),
  'RLS is enabled on products'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'products'
      AND policyname LIKE 'products_%'
  ),
  5::bigint,
  'products has five separate policies'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'products'
      AND cmd = 'ALL'
  ),
  0::bigint,
  'products has no FOR ALL policy'
);

SELECT * FROM finish();

ROLLBACK;
