BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(15);

SELECT is(
  (SELECT public FROM storage.buckets WHERE id = 'product-images'),
  true,
  'product-images bucket exists and is public'
);

SELECT is(
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'product-images'),
  5242880::bigint,
  'product-images file size limit is 5 MB'
);

SELECT ok(
  (
    SELECT allowed_mime_types
    FROM storage.buckets
    WHERE id = 'product-images'
  ) = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[],
  'product-images allowed MIME types are exact'
);

SELECT is(
  (SELECT count(*)::bigint FROM storage.buckets WHERE id IN ('customer-uploads', 'try-on-results')),
  2::bigint,
  'customer-uploads and try-on-results buckets exist'
);

SELECT ok(
  public.is_valid_product_image_path(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/cccccccc-cccc-cccc-cccc-cccccccccccc/11111111-1111-1111-1111-111111111111.jpg'
  ),
  'valid product image path passes validation'
);

SELECT ok(
  NOT public.is_valid_product_image_path('not-a-valid/path.svg'),
  'invalid product image path fails validation'
);

SELECT is(
  public.storage_product_images_brand_id('not-a-valid/path.jpg'),
  NULL::uuid,
  'malformed storage path returns null brand id safely'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname LIKE 'product_images_%'
  ),
  3::bigint,
  'product-images has insert, select and delete storage policies'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname LIKE 'product_images_%'
      AND cmd = 'ALL'
  ),
  0::bigint,
  'product-images has no FOR ALL storage policy'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'product_images_select_editors'
      AND cmd = 'SELECT'
  ),
  'product-images has select policy for merchant remove operations'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'product_images_delete_editors'
      AND cmd = 'DELETE'
  ),
  'product-images has delete policy scoped to brand folder membership'
);

SELECT tests.create_auth_user('11111111-1111-1111-1111-111111111111'::uuid, 'owner-a@test.local', 'Owner A');
SELECT tests.create_auth_user('33333333-3333-3333-3333-333333333333'::uuid, 'editor-a@test.local', 'Editor A');
SELECT tests.create_auth_user('44444444-4444-4444-4444-444444444444'::uuid, 'analyst-a@test.local', 'Analyst A');
SELECT tests.create_auth_user('55555555-5555-5555-5555-555555555555'::uuid, 'unrelated@test.local', 'Unrelated');

SELECT tests.seed_brand(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Brand A',
  'brand-a',
  '11111111-1111-1111-1111-111111111111'::uuid
);
SELECT tests.add_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '33333333-3333-3333-3333-333333333333'::uuid, 'editor');
SELECT tests.add_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '44444444-4444-4444-4444-444444444444'::uuid, 'analyst');

SELECT tests.set_jwt_claims('33333333-3333-3333-3333-333333333333'::uuid);
SET LOCAL role authenticated;

SELECT lives_ok(
  $$
    INSERT INTO storage.objects (bucket_id, name, owner, metadata)
    VALUES (
      'product-images',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/cccccccc-cccc-cccc-cccc-cccccccccccc/22222222-2222-2222-2222-222222222222.jpg',
      '33333333-3333-3333-3333-333333333333'::uuid,
      '{}'::jsonb
    )
  $$,
  'editor can upload into own brand folder'
);

SELECT tests.set_jwt_claims('55555555-5555-5555-5555-555555555555'::uuid);
SET LOCAL role authenticated;

SELECT throws_ok(
  $$
    INSERT INTO storage.objects (bucket_id, name, owner, metadata)
    VALUES (
      'product-images',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/cccccccc-cccc-cccc-cccc-cccccccccccc/33333333-3333-3333-3333-333333333333.jpg',
      '55555555-5555-5555-5555-555555555555'::uuid,
      '{}'::jsonb
    )
  $$,
  '42501',
  NULL,
  'unrelated user cannot upload into another brand folder'
);

SELECT tests.set_jwt_claims('44444444-4444-4444-4444-444444444444'::uuid);
SET LOCAL role authenticated;

SELECT throws_ok(
  $$
    INSERT INTO storage.objects (bucket_id, name, owner, metadata)
    VALUES (
      'product-images',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/cccccccc-cccc-cccc-cccc-cccccccccccc/11111111-1111-1111-1111-111111111111.jpg',
      '44444444-4444-4444-4444-444444444444'::uuid,
      '{}'::jsonb
    )
  $$,
  '42501',
  NULL,
  'analyst cannot upload product images'
);

SELECT tests.clear_jwt_claims();
SET LOCAL role anon;

SELECT throws_ok(
  $$
    INSERT INTO storage.objects (bucket_id, name, owner, metadata)
    VALUES (
      'product-images',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/cccccccc-cccc-cccc-cccc-cccccccccccc/11111111-1111-1111-1111-111111111111.jpg',
      NULL,
      '{}'::jsonb
    )
  $$,
  '42501',
  NULL,
  'anon cannot upload product images'
);

SELECT * FROM finish();

ROLLBACK;
