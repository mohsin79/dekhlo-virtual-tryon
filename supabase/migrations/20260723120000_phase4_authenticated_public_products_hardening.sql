-- Phase 4 corrective: restrict authenticated public product table access

DROP POLICY products_select_public_active ON public.products;

CREATE POLICY products_select_public_active
  ON public.products
  FOR SELECT
  TO anon
  USING (is_active = true);

DROP VIEW IF EXISTS public.public_catalog_products;

CREATE VIEW public.public_catalog_products
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  p.id AS product_id,
  p.name AS product_name,
  p.slug AS product_slug,
  p.product_image_path,
  p.category,
  b.id AS brand_id,
  b.name AS brand_name,
  b.slug AS brand_slug,
  b.logo_path,
  b.widget_config
FROM public.products AS p
INNER JOIN public.brands AS b ON b.id = p.brand_id
WHERE p.is_active = true;

REVOKE ALL ON TABLE public.public_catalog_products FROM PUBLIC;
REVOKE ALL ON TABLE public.public_catalog_products FROM anon;
REVOKE ALL ON TABLE public.public_catalog_products FROM authenticated;
REVOKE ALL ON TABLE public.public_catalog_products FROM service_role;
GRANT SELECT ON TABLE public.public_catalog_products TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_product_by_slugs(
  p_brand_slug text,
  p_product_slug text
)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  product_slug text,
  product_image_path text,
  category text,
  brand_id uuid,
  brand_name text,
  brand_slug text,
  logo_path text,
  widget_config jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p.id,
    p.name,
    p.slug,
    p.product_image_path,
    p.category,
    b.id,
    b.name,
    b.slug,
    b.logo_path,
    b.widget_config
  FROM public.products AS p
  INNER JOIN public.brands AS b ON b.id = p.brand_id
  WHERE p_brand_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    AND p_product_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    AND b.slug = p_brand_slug
    AND p.slug = p_product_slug
    AND p.is_active = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_product_by_slugs(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_product_by_slugs(text, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_public_product_by_slugs(text, text) TO anon, authenticated;
