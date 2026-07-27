-- Phase 8B.1: leads RLS and grants (owner/admin SELECT only)

REVOKE ALL ON TABLE public.leads FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.leads TO authenticated;
GRANT ALL ON TABLE public.leads TO service_role;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads FORCE ROW LEVEL SECURITY;

CREATE POLICY leads_select_owner_admin
  ON public.leads
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.brand_members AS bm
      WHERE bm.brand_id = leads.brand_id
        AND bm.user_id = auth.uid()
        AND bm.role IN (
          'owner'::public.brand_role,
          'admin'::public.brand_role
        )
    )
  );
