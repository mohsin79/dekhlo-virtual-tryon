-- Phase 6: try_on_sessions RLS, grants, and merchant-safe projection

REVOKE ALL ON TABLE public.try_on_sessions FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.try_on_sessions TO service_role;

GRANT SELECT (
  id,
  brand_id,
  product_id,
  status,
  credit_cost,
  person_storage_path,
  result_storage_path,
  upload_validated_at,
  provider_job_id,
  provider_request_id,
  consent_to_store,
  expires_at,
  deleted_at,
  error_code,
  sanitized_error_message,
  client_request_id,
  created_at,
  completed_at
) ON public.try_on_sessions TO authenticated;

GRANT SELECT ON public.merchant_try_on_sessions TO authenticated;

ALTER TABLE public.try_on_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY try_on_sessions_select_members
  ON public.try_on_sessions
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND public.user_has_brand_role(
      brand_id,
      ARRAY[
        'owner'::public.brand_role,
        'admin'::public.brand_role,
        'editor'::public.brand_role,
        'analyst'::public.brand_role
      ]
    )
  );
