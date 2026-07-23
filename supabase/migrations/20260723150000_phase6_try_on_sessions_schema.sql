-- Phase 6: try_on_sessions schema and credit_transactions.session_id

CREATE UNIQUE INDEX products_brand_id_id_key ON public.products (brand_id, id);

CREATE TYPE public.try_on_session_status AS ENUM (
  'pending_upload',
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled'
);

CREATE OR REPLACE FUNCTION public.try_on_v1_credit_cost()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT 1;
$$;

REVOKE ALL ON FUNCTION public.try_on_v1_credit_cost() FROM PUBLIC;

CREATE TABLE public.try_on_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  status public.try_on_session_status NOT NULL DEFAULT 'pending_upload',
  credit_cost integer,
  person_storage_path text,
  result_storage_path text,
  upload_validated_at timestamptz,
  provider_job_id text,
  provider_request_id text,
  consent_to_store boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  deleted_at timestamptz,
  error_code text,
  sanitized_error_message text,
  client_request_id text NOT NULL,
  anonymous_token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT try_on_sessions_brand_product_fkey
    FOREIGN KEY (brand_id, product_id)
    REFERENCES public.products (brand_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT try_on_sessions_client_request_id_uuid_chk
    CHECK (
      client_request_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
  CONSTRAINT try_on_sessions_client_request_id_key UNIQUE (client_request_id),
  CONSTRAINT try_on_sessions_anonymous_token_hash_format_chk
    CHECK (
      anonymous_token_hash ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT try_on_sessions_credit_cost_non_negative_chk
    CHECK (credit_cost IS NULL OR credit_cost >= 0),
  CONSTRAINT try_on_sessions_status_credit_cost_chk
    CHECK (
      (
        status = 'pending_upload'
        AND COALESCE(credit_cost, 0) = 0
      )
      OR (
        status IN ('queued', 'processing', 'completed')
        AND credit_cost > 0
      )
      OR (
        status IN ('failed', 'cancelled')
        AND (credit_cost IS NULL OR credit_cost >= 0)
      )
    ),
  CONSTRAINT try_on_sessions_completed_requirements_chk
    CHECK (
      status <> 'completed'
      OR (
        credit_cost > 0
        AND result_storage_path IS NOT NULL
        AND completed_at IS NOT NULL
        AND upload_validated_at IS NOT NULL
      )
    ),
  CONSTRAINT try_on_sessions_queued_processing_require_upload_chk
    CHECK (
      status NOT IN ('queued', 'processing', 'completed')
      OR upload_validated_at IS NOT NULL
    ),
  CONSTRAINT try_on_sessions_person_path_format_chk
    CHECK (
      person_storage_path IS NULL
      OR person_storage_path ~ (
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
        || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
        || 'person\.(jpg|jpeg|png|webp)$'
      )
    ),
  CONSTRAINT try_on_sessions_result_path_format_chk
    CHECK (
      result_storage_path IS NULL
      OR result_storage_path ~ (
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
        || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
        || 'result\.png$'
      )
    )
);

CREATE INDEX try_on_sessions_brand_id_idx ON public.try_on_sessions (brand_id);
CREATE INDEX try_on_sessions_product_id_idx ON public.try_on_sessions (product_id);
CREATE INDEX try_on_sessions_brand_created_at_idx ON public.try_on_sessions (brand_id, created_at DESC);
CREATE INDEX try_on_sessions_status_idx ON public.try_on_sessions (status);
CREATE INDEX try_on_sessions_expires_at_idx ON public.try_on_sessions (expires_at);
CREATE INDEX try_on_sessions_client_request_id_idx ON public.try_on_sessions (client_request_id);
CREATE INDEX try_on_sessions_provider_job_id_idx ON public.try_on_sessions (provider_job_id)
  WHERE provider_job_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_try_on_session_immutable_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.brand_id IS DISTINCT FROM NEW.brand_id THEN
    RAISE EXCEPTION 'brand_id is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.product_id IS DISTINCT FROM NEW.product_id THEN
    RAISE EXCEPTION 'product_id is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.client_request_id IS DISTINCT FROM NEW.client_request_id THEN
    RAISE EXCEPTION 'client_request_id is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.anonymous_token_hash IS DISTINCT FROM NEW.anonymous_token_hash THEN
    RAISE EXCEPTION 'anonymous_token_hash is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(OLD.credit_cost, 0) > 0
     AND NEW.credit_cost IS DISTINCT FROM OLD.credit_cost THEN
    RAISE EXCEPTION 'credit_cost is immutable after queue'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'completed'
     AND NEW.status IN ('queued', 'processing', 'pending_upload') THEN
    RAISE EXCEPTION 'completed sessions cannot regress'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER try_on_sessions_prevent_immutable_changes
BEFORE UPDATE ON public.try_on_sessions
FOR EACH ROW
EXECUTE FUNCTION public.prevent_try_on_session_immutable_changes();

ALTER TABLE public.credit_transactions
  ADD COLUMN session_id uuid REFERENCES public.try_on_sessions (id) ON DELETE RESTRICT;

CREATE INDEX credit_transactions_session_id_idx ON public.credit_transactions (session_id);

ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_grant_no_session_chk
    CHECK (
      type <> 'grant'::public.credit_transaction_type
      OR session_id IS NULL
    );

ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_lifecycle_requires_session_chk
    CHECK (
      type NOT IN (
        'reserve'::public.credit_transaction_type,
        'consume'::public.credit_transaction_type,
        'release'::public.credit_transaction_type
      )
      OR session_id IS NOT NULL
    );

CREATE OR REPLACE VIEW public.merchant_try_on_sessions
WITH (security_invoker = true)
AS
SELECT
  s.id,
  s.brand_id,
  s.product_id,
  s.status,
  s.credit_cost,
  s.upload_validated_at,
  s.provider_job_id,
  s.provider_request_id,
  s.consent_to_store,
  s.expires_at,
  s.deleted_at,
  s.error_code,
  s.sanitized_error_message,
  s.client_request_id,
  s.created_at,
  s.completed_at
FROM public.try_on_sessions AS s
WHERE s.deleted_at IS NULL;

REVOKE ALL ON public.merchant_try_on_sessions FROM PUBLIC, anon;
