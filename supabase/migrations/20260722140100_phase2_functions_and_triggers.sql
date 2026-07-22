-- Phase 2: shared helpers and auth profile trigger

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_full_name text;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data ->> 'full_name', '');

  IF length(v_full_name) > 200 THEN
    v_full_name := left(v_full_name, 200);
  END IF;

  INSERT INTO public.profiles (id, full_name, avatar_path)
  VALUES (NEW.id, v_full_name, NULL)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.user_has_brand_role(
  p_brand_id uuid,
  p_roles public.brand_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.brand_members bm
    WHERE bm.brand_id = p_brand_id
      AND bm.user_id = (SELECT auth.uid())
      AND bm.role = ANY (p_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_brand_role(uuid, public.brand_role[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_brand_role(uuid, public.brand_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_brand_role(uuid, public.brand_role[]) TO service_role;
