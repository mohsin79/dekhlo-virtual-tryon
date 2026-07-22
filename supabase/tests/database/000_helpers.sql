-- pgTAP helpers for Phase 2 database tests (not applied in migrations)

CREATE SCHEMA IF NOT EXISTS tests;

GRANT USAGE ON SCHEMA tests TO authenticated, anon, service_role, postgres;

CREATE OR REPLACE FUNCTION tests.create_auth_user(
  p_id uuid,
  p_email text,
  p_full_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  VALUES (
    p_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    p_email,
    extensions.crypt('password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    CASE
      WHEN p_full_name IS NULL THEN '{}'::jsonb
      ELSE jsonb_build_object('full_name', p_full_name)
    END,
    now(),
    now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION tests.set_jwt_claims(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION tests.clear_jwt_claims()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION tests.seed_brand(
  p_brand_id uuid,
  p_name text,
  p_slug text,
  p_owner_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.brands (id, name, slug)
  VALUES (p_brand_id, p_name, p_slug);

  INSERT INTO public.brand_members (brand_id, user_id, role)
  VALUES (p_brand_id, p_owner_id, 'owner'::public.brand_role);
END;
$$;

CREATE OR REPLACE FUNCTION tests.add_member(
  p_brand_id uuid,
  p_user_id uuid,
  p_role public.brand_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.brand_members (brand_id, user_id, role)
  VALUES (p_brand_id, p_user_id, p_role);
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tests FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO authenticated, anon, service_role, postgres;

SELECT plan(1);
SELECT pass('Phase 2 test helpers installed');
SELECT * FROM finish();
