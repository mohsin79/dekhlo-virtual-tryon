-- Phase 2: row level security policies

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_members ENABLE ROW LEVEL SECURITY;

-- profiles

CREATE POLICY profiles_select_own
ON public.profiles
FOR SELECT
TO authenticated
USING (id = (SELECT auth.uid()));

CREATE POLICY profiles_update_own
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = (SELECT auth.uid()))
WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY profiles_insert_own
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (id = (SELECT auth.uid()));

-- brands: INSERT deferred to Phase 3 onboarding RPC (no authenticated INSERT policy)

CREATE POLICY brands_select_members
ON public.brands
FOR SELECT
TO authenticated
USING (
  public.user_has_brand_role(
    id,
    ARRAY['owner', 'admin', 'editor', 'analyst']::public.brand_role[]
  )
);

CREATE POLICY brands_update_owner_admin
ON public.brands
FOR UPDATE
TO authenticated
USING (
  public.user_has_brand_role(id, ARRAY['owner', 'admin']::public.brand_role[])
)
WITH CHECK (
  public.user_has_brand_role(id, ARRAY['owner', 'admin']::public.brand_role[])
);

CREATE POLICY brands_delete_owner
ON public.brands
FOR DELETE
TO authenticated
USING (
  public.user_has_brand_role(id, ARRAY['owner']::public.brand_role[])
);

-- brand_members

CREATE POLICY brand_members_select_members
ON public.brand_members
FOR SELECT
TO authenticated
USING (
  public.user_has_brand_role(
    brand_id,
    ARRAY['owner', 'admin', 'editor', 'analyst']::public.brand_role[]
  )
);

CREATE POLICY brand_members_insert_owner_admin
ON public.brand_members
FOR INSERT
TO authenticated
WITH CHECK (
  role <> 'owner'::public.brand_role
  AND user_id <> (SELECT auth.uid())
  AND (
    public.user_has_brand_role(brand_id, ARRAY['owner']::public.brand_role[])
    OR (
      public.user_has_brand_role(brand_id, ARRAY['admin']::public.brand_role[])
      AND role IN ('admin'::public.brand_role, 'editor'::public.brand_role, 'analyst'::public.brand_role)
    )
  )
);

CREATE POLICY brand_members_update_owner
ON public.brand_members
FOR UPDATE
TO authenticated
USING (
  public.user_has_brand_role(brand_id, ARRAY['owner']::public.brand_role[])
)
WITH CHECK (
  public.user_has_brand_role(brand_id, ARRAY['owner']::public.brand_role[])
  AND role <> 'owner'::public.brand_role
  AND user_id <> (SELECT auth.uid())
);

CREATE POLICY brand_members_delete_owner_admin
ON public.brand_members
FOR DELETE
TO authenticated
USING (
  public.user_has_brand_role(brand_id, ARRAY['owner', 'admin']::public.brand_role[])
  AND user_id <> (SELECT auth.uid())
  AND role <> 'owner'::public.brand_role
);
