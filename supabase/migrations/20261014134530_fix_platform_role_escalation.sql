-- Hardening for profiles.platform_role. Already applied to production on 2026-10-14
-- (same version and name, so `supabase db push` treats it as applied). Every statement
-- is idempotent, so re-running it changes nothing.
--
-- 1. platform_role_change_is_trusted() could return NULL instead of false
--    (current_setting(..., true) is NULL when unset). The trigger used
--    `AND NOT <fn>()`, so NULL skipped the exception. Wrap in coalesce(..., false).
-- 2. authenticated had UPDATE on every profiles column. The app only lets users edit
--    full_name and avatar_path (the brand app itself only reads profiles).
-- 3. Internal trigger functions should not be callable over the REST API.

CREATE OR REPLACE FUNCTION public.platform_role_change_is_trusted()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  SELECT coalesce(
    CURRENT_USER IN ('postgres', 'supabase_admin', 'service_role')
    OR current_setting('role', true) = 'service_role'
    OR current_setting('app.allow_platform_role_change', true) = 'on',
    false
  );
$$;

REVOKE ALL ON FUNCTION public.platform_role_change_is_trusted() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_role_change_is_trusted() TO service_role;

REVOKE UPDATE ON TABLE public.profiles FROM anon, authenticated;
REVOKE INSERT ON TABLE public.profiles FROM anon;
GRANT UPDATE (full_name, avatar_path) ON TABLE public.profiles TO authenticated;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.initialize_brand_credit_balance() FROM anon, authenticated, PUBLIC;

ALTER FUNCTION public.set_updated_at() SET search_path TO '';
