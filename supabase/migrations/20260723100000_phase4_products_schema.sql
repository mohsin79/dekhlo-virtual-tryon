-- Phase 4: merchant product catalog schema

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  product_image_path text NOT NULL,
  category text,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_name_not_empty_chk CHECK (btrim(name) <> ''),
  CONSTRAINT products_slug_format_chk CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT products_image_path_not_empty_chk CHECK (btrim(product_image_path) <> '')
);

CREATE UNIQUE INDEX products_brand_slug_key ON public.products (brand_id, slug);
CREATE INDEX products_brand_id_idx ON public.products (brand_id);
CREATE INDEX products_brand_active_idx ON public.products (brand_id, is_active)
  WHERE is_active = true;

CREATE TRIGGER products_set_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.prevent_product_brand_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.brand_id IS DISTINCT FROM OLD.brand_id THEN
    RAISE EXCEPTION 'Product brand cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER products_prevent_brand_change
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.prevent_product_brand_change();
