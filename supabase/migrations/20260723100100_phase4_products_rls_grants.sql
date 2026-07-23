-- Phase 4: product table grants and RLS

REVOKE ALL ON TABLE public.products FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.products TO authenticated;
GRANT ALL ON TABLE public.products TO service_role;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY products_select_members
  ON public.products
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_brand_role(
      brand_id,
      ARRAY[
        'owner'::public.brand_role,
        'admin'::public.brand_role,
        'editor'::public.brand_role,
        'analyst'::public.brand_role
      ]
    )
  );

CREATE POLICY products_insert_editors
  ON public.products
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.user_has_brand_role(
      brand_id,
      ARRAY[
        'owner'::public.brand_role,
        'admin'::public.brand_role,
        'editor'::public.brand_role
      ]
    )
  );

CREATE POLICY products_update_editors
  ON public.products
  FOR UPDATE
  TO authenticated
  USING (
    public.user_has_brand_role(
      brand_id,
      ARRAY[
        'owner'::public.brand_role,
        'admin'::public.brand_role,
        'editor'::public.brand_role
      ]
    )
  )
  WITH CHECK (
    public.user_has_brand_role(
      brand_id,
      ARRAY[
        'owner'::public.brand_role,
        'admin'::public.brand_role,
        'editor'::public.brand_role
      ]
    )
  );

CREATE POLICY products_delete_editors
  ON public.products
  FOR DELETE
  TO authenticated
  USING (
    public.user_has_brand_role(
      brand_id,
      ARRAY[
        'owner'::public.brand_role,
        'admin'::public.brand_role,
        'editor'::public.brand_role
      ]
    )
  );
