-- Phase 4 corrective: allow merchant storage remove (requires SELECT + DELETE)

CREATE POLICY product_images_select_editors
  ON storage.objects
  FOR SELECT
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
