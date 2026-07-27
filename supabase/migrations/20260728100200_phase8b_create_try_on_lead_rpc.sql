-- Phase 8B.1: create_try_on_lead RPC (service_role only)

CREATE OR REPLACE FUNCTION public.create_try_on_lead(
  p_session_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_consent_to_contact boolean,
  p_consent_to_marketing boolean,
  p_idempotency_key uuid,
  p_metadata jsonb
)
RETURNS TABLE (
  lead_id uuid,
  was_created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.try_on_sessions%ROWTYPE;
  v_existing public.leads%ROWTYPE;
  v_existing_key public.leads%ROWTYPE;
  v_full_name text;
  v_email text;
  v_phone text;
  v_phone_raw text;
  v_marketing boolean;
  v_metadata jsonb;
  v_key text;
  v_value text;
  v_lead_id uuid;
  v_digit_count integer;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'LEAD_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'LEAD_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  IF p_consent_to_contact IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'LEAD_CONSENT_REQUIRED'
      USING ERRCODE = '22023';
  END IF;

  v_marketing := COALESCE(p_consent_to_marketing, false);

  v_full_name := NULLIF(btrim(COALESCE(p_full_name, '')), '');

  IF v_full_name IS NOT NULL AND char_length(v_full_name) > 120 THEN
    RAISE EXCEPTION 'LEAD_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  v_email := lower(btrim(COALESCE(p_email, '')));

  IF v_email = '' OR char_length(v_email) > 254 OR char_length(v_email) < 3 THEN
    RAISE EXCEPTION 'LEAD_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  v_phone_raw := NULLIF(btrim(COALESCE(p_phone, '')), '');

  IF v_phone_raw IS NULL THEN
    v_phone := NULL;
  ELSE
    v_phone := regexp_replace(v_phone_raw, '[\s\-()]', '', 'g');

    IF v_phone ~ '\+' AND NOT v_phone ~ '^\+[0-9]+$' THEN
      RAISE EXCEPTION 'LEAD_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;

    IF v_phone !~ '^\+?[0-9]+$' THEN
      RAISE EXCEPTION 'LEAD_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;

    v_digit_count := char_length(regexp_replace(v_phone, '^\+', ''));

    IF v_digit_count < 7 OR v_digit_count > 15 THEN
      RAISE EXCEPTION 'LEAD_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;

    IF char_length(v_phone) > 16 THEN
      RAISE EXCEPTION 'LEAD_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_metadata := COALESCE(p_metadata, '{}'::jsonb);

  IF jsonb_typeof(v_metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'LEAD_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  IF pg_column_size(v_metadata) > 2048 THEN
    RAISE EXCEPTION 'LEAD_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_metadata)
  LOOP
    IF v_key NOT IN ('brand_name', 'brand_slug', 'product_name', 'product_slug') THEN
      RAISE EXCEPTION 'LEAD_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;

    v_value := v_metadata ->> v_key;

    IF v_value IS NULL OR btrim(v_value) = '' THEN
      RAISE EXCEPTION 'LEAD_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;

    IF v_key IN ('brand_name', 'product_name') AND char_length(v_value) > 200 THEN
      RAISE EXCEPTION 'LEAD_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;

    IF v_key IN ('brand_slug', 'product_slug') AND char_length(v_value) > 128 THEN
      RAISE EXCEPTION 'LEAD_INVALID_INPUT'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF NOT (
    v_metadata ? 'brand_name'
    AND v_metadata ? 'brand_slug'
    AND v_metadata ? 'product_name'
    AND v_metadata ? 'product_slug'
  ) THEN
    RAISE EXCEPTION 'LEAD_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_session
  FROM public.try_on_sessions AS s
  WHERE s.id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEAD_SESSION_UNAVAILABLE'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_session.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'LEAD_SESSION_EXPIRED'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_session.expires_at <= now() THEN
    RAISE EXCEPTION 'LEAD_SESSION_EXPIRED'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_session.status IS DISTINCT FROM 'completed'::public.try_on_session_status THEN
    RAISE EXCEPTION 'LEAD_SESSION_NOT_COMPLETED'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_session.completed_at IS NULL OR v_session.result_storage_path IS NULL THEN
    RAISE EXCEPTION 'LEAD_SESSION_NOT_COMPLETED'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.products AS p
    WHERE p.id = v_session.product_id
      AND p.brand_id = v_session.brand_id
  ) THEN
    RAISE EXCEPTION 'LEAD_SESSION_UNAVAILABLE'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_existing_key
  FROM public.leads AS l
  WHERE l.idempotency_key = p_idempotency_key::text;

  IF FOUND AND v_existing_key.try_on_session_id IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'LEAD_CONFLICT'
      USING ERRCODE = '23505';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.leads AS l
  WHERE l.try_on_session_id = p_session_id;

  IF FOUND THEN
    IF v_existing.idempotency_key IS DISTINCT FROM p_idempotency_key::text
       OR v_existing.full_name IS DISTINCT FROM v_full_name
       OR v_existing.email IS DISTINCT FROM v_email
       OR v_existing.phone IS DISTINCT FROM v_phone
       OR v_existing.consent_to_contact IS DISTINCT FROM true
       OR v_existing.consent_to_marketing IS DISTINCT FROM v_marketing THEN
      RAISE EXCEPTION 'LEAD_CONFLICT'
        USING ERRCODE = '23505';
    END IF;

    lead_id := v_existing.id;
    was_created := false;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.leads (
    brand_id,
    product_id,
    try_on_session_id,
    full_name,
    email,
    phone,
    consent_to_contact,
    consent_to_marketing,
    consented_at,
    source,
    idempotency_key,
    metadata
  )
  VALUES (
    v_session.brand_id,
    v_session.product_id,
    p_session_id,
    v_full_name,
    v_email,
    v_phone,
    true,
    v_marketing,
    now(),
    'try_on_result',
    p_idempotency_key::text,
    v_metadata
  )
  RETURNING id INTO v_lead_id;

  lead_id := v_lead_id;
  was_created := true;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.create_try_on_lead(
  uuid,
  text,
  text,
  text,
  boolean,
  boolean,
  uuid,
  jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_try_on_lead(
  uuid,
  text,
  text,
  text,
  boolean,
  boolean,
  uuid,
  jsonb
) TO service_role;
