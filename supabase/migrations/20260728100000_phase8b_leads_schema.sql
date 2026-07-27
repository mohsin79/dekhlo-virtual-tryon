-- Phase 8B.1: leads schema (immutable shopper PII linked to completed try-on sessions)

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE RESTRICT,
  product_id uuid NOT NULL,
  try_on_session_id uuid NOT NULL REFERENCES public.try_on_sessions (id) ON DELETE RESTRICT,
  full_name text,
  email text NOT NULL,
  phone text,
  consent_to_contact boolean NOT NULL,
  consent_to_marketing boolean NOT NULL DEFAULT false,
  consented_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'try_on_result',
  idempotency_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_brand_product_fkey
    FOREIGN KEY (brand_id, product_id)
    REFERENCES public.products (brand_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT leads_try_on_session_id_key UNIQUE (try_on_session_id),
  CONSTRAINT leads_idempotency_key_key UNIQUE (idempotency_key),
  CONSTRAINT leads_consent_to_contact_required_chk
    CHECK (consent_to_contact = true),
  CONSTRAINT leads_source_try_on_result_chk
    CHECK (source = 'try_on_result'),
  CONSTRAINT leads_email_normalized_chk
    CHECK (
      email = lower(btrim(email))
      AND char_length(email) BETWEEN 3 AND 254
    ),
  CONSTRAINT leads_full_name_normalized_chk
    CHECK (
      full_name IS NULL
      OR (
        full_name = btrim(full_name)
        AND btrim(full_name) <> ''
        AND char_length(full_name) <= 120
      )
    ),
  CONSTRAINT leads_phone_normalized_chk
    CHECK (
      phone IS NULL
      OR (
        char_length(phone) <= 16
        AND phone ~ '^\+?[0-9]{7,15}$'
      )
    ),
  CONSTRAINT leads_idempotency_key_uuid_chk
    CHECK (
      idempotency_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
  CONSTRAINT leads_metadata_object_chk
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT leads_metadata_size_chk
    CHECK (pg_column_size(metadata) <= 2048)
);

CREATE INDEX leads_brand_created_at_idx
  ON public.leads (brand_id, created_at DESC, id DESC);

CREATE INDEX leads_brand_email_idx
  ON public.leads (brand_id, email);

CREATE INDEX leads_brand_product_idx
  ON public.leads (brand_id, product_id);

CREATE INDEX leads_try_on_session_id_idx
  ON public.leads (try_on_session_id);

CREATE OR REPLACE FUNCTION public.prevent_lead_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Leads are immutable'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_lead_mutation() FROM PUBLIC;

CREATE TRIGGER leads_prevent_update
BEFORE UPDATE ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.prevent_lead_mutation();

CREATE TRIGGER leads_prevent_delete
BEFORE DELETE ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.prevent_lead_mutation();
