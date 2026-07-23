-- Phase 4: public product-images bucket and Storage RLS

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
);

CREATE OR REPLACE FUNCTION public.storage_product_images_brand_id(object_path text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
DECLARE
  v_segment text;
BEGIN
  IF object_path IS NULL OR object_path = '' THEN
    RETURN NULL;
  END IF;

  v_segment := split_part(object_path, '/', 1);

  IF v_segment !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;

  RETURN v_segment::uuid;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_valid_product_image_path(object_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT object_path ~ (
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.'
    || '(jpg|jpeg|png|webp)$'
  );
$$;

REVOKE ALL ON FUNCTION public.storage_product_images_brand_id(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_valid_product_image_path(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_product_images_brand_id(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_product_image_path(text) TO authenticated, service_role;

CREATE POLICY product_images_insert_editors
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND public.is_valid_product_image_path(name)
    AND public.storage_product_images_brand_id(name) IS NOT NULL
    AND public.user_has_brand_role(
      public.storage_product_images_brand_id(name),
      ARRAY[
        'owner'::public.brand_role,
        'admin'::public.brand_role,
        'editor'::public.brand_role
      ]
    )
  );

CREATE POLICY product_images_delete_editors
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'product-images'
    AND public.is_valid_product_image_path(name)
    AND public.storage_product_images_brand_id(name) IS NOT NULL
    AND public.user_has_brand_role(
      public.storage_product_images_brand_id(name),
      ARRAY[
        'owner'::public.brand_role,
        'admin'::public.brand_role,
        'editor'::public.brand_role
      ]
    )
  );
