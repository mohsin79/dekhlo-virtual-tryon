-- Phase 3: atomic brand onboarding RPC

CREATE OR REPLACE FUNCTION public.create_brand_with_owner(
  p_name text,
  p_slug text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_brand_id uuid;
  v_name text;
  v_slug text;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '42501';
  END IF;

  v_name := btrim(p_name);
  v_slug := lower(btrim(p_slug));

  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'Brand name is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(v_name) > 200 THEN
    RAISE EXCEPTION 'Brand name is too long'
      USING ERRCODE = '22023';
  END IF;

  IF v_slug IS NULL OR v_slug = '' THEN
    RAISE EXCEPTION 'Brand slug is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(v_slug) > 100 THEN
    RAISE EXCEPTION 'Brand slug is too long'
      USING ERRCODE = '22023';
  END IF;

  IF v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Invalid brand slug'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Profile not found'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.brands (name, slug)
  VALUES (v_name, v_slug)
  RETURNING id INTO v_brand_id;

  INSERT INTO public.brand_members (brand_id, user_id, role)
  VALUES (v_brand_id, v_user_id, 'owner'::public.brand_role);

  RETURN v_brand_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Brand slug already exists'
      USING ERRCODE = '23505';
END;
$$;

REVOKE ALL ON FUNCTION public.create_brand_with_owner(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_brand_with_owner(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_brand_with_owner(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_brand_with_owner(text, text) TO service_role;
