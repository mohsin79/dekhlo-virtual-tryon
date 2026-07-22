-- Phase 2: explicit table privileges (auto-expose disabled on cloud project)

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brands FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_members FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON TYPE public.brand_role TO authenticated, service_role;

GRANT SELECT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT, UPDATE, DELETE ON TABLE public.brands TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brand_members TO authenticated;

GRANT ALL ON TABLE public.profiles TO service_role;
GRANT ALL ON TABLE public.brands TO service_role;
GRANT ALL ON TABLE public.brand_members TO service_role;
