-- Phase 8A.1: platform role type, profiles column, escalation protection

CREATE TYPE public.platform_role AS ENUM (
  'platform_admin'
);

ALTER TABLE public.profiles
  ADD COLUMN platform_role public.platform_role;

CREATE OR REPLACE FUNCTION public.platform_role_change_is_trusted()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    CURRENT_USER IN ('postgres', 'supabase_admin', 'service_role')
    OR current_setting('role', true) = 'service_role'
    OR current_setting('app.allow_platform_role_change', true) = 'on';
$$;

REVOKE ALL ON FUNCTION public.platform_role_change_is_trusted() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_role_change_is_trusted() TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_platform_role_change_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.platform_role IS NOT NULL
       AND NOT public.platform_role_change_is_trusted() THEN
      RAISE EXCEPTION 'platform_role cannot be assigned by this role'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.platform_role IS DISTINCT FROM OLD.platform_role
       AND NOT public.platform_role_change_is_trusted() THEN
      RAISE EXCEPTION 'platform_role cannot be changed by this role'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_platform_role_change_policy() FROM PUBLIC;

CREATE TRIGGER profiles_enforce_platform_role_change
BEFORE INSERT OR UPDATE OF platform_role ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_platform_role_change_policy();
