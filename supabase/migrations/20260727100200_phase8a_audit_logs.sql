-- Phase 8A.1: append-only audit_logs with platform-admin SELECT RLS

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  brand_id uuid REFERENCES public.brands (id) ON DELETE RESTRICT,
  target_type text,
  target_id uuid,
  reason text NOT NULL,
  idempotency_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_action_not_empty_chk CHECK (btrim(action) <> ''),
  CONSTRAINT audit_logs_action_length_chk CHECK (char_length(action) <= 128),
  CONSTRAINT audit_logs_reason_not_empty_chk CHECK (btrim(reason) <> ''),
  CONSTRAINT audit_logs_reason_length_chk CHECK (char_length(reason) <= 500),
  CONSTRAINT audit_logs_idempotency_key_not_empty_chk CHECK (btrim(idempotency_key) <> ''),
  CONSTRAINT audit_logs_idempotency_key_length_chk CHECK (char_length(idempotency_key) <= 128),
  CONSTRAINT audit_logs_metadata_object_chk CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX audit_logs_idempotency_key_key ON public.audit_logs (idempotency_key);
CREATE INDEX audit_logs_actor_user_id_idx ON public.audit_logs (actor_user_id);
CREATE INDEX audit_logs_brand_id_idx ON public.audit_logs (brand_id);
CREATE INDEX audit_logs_action_idx ON public.audit_logs (action);
CREATE INDEX audit_logs_created_at_idx ON public.audit_logs (created_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are append-only'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_audit_log_mutation() FROM PUBLIC;

CREATE TRIGGER audit_logs_prevent_update
BEFORE UPDATE ON public.audit_logs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_audit_log_mutation();

CREATE TRIGGER audit_logs_prevent_delete
BEFORE DELETE ON public.audit_logs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_audit_log_mutation();

REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_select_platform_admin
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin((SELECT auth.uid())));
