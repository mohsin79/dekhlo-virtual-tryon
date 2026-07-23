-- Phase 5: trusted grant_brand_credits RPC

CREATE OR REPLACE FUNCTION public.grant_brand_credits(
  p_brand_id uuid,
  p_amount integer,
  p_idempotency_key text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  transaction_id uuid,
  brand_id uuid,
  granted_credits integer,
  reserved_credits integer,
  consumed_credits integer,
  available_credits integer,
  was_created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing public.credit_transactions%ROWTYPE;
  v_balance public.brand_credit_balances%ROWTYPE;
  v_transaction_id uuid;
  v_metadata jsonb;
BEGIN
  IF p_brand_id IS NULL THEN
    RAISE EXCEPTION 'Brand is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be a positive integer'
      USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(p_idempotency_key) > 128 THEN
    RAISE EXCEPTION 'Idempotency key is too long'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.brands AS b
    WHERE b.id = p_brand_id
  ) THEN
    RAISE EXCEPTION 'Brand not found'
      USING ERRCODE = 'P0001';
  END IF;

  v_metadata := COALESCE(p_metadata, '{}'::jsonb);

  IF jsonb_typeof(v_metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Metadata must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('grant_brand_credits:' || p_idempotency_key));

  SELECT *
  INTO v_existing
  FROM public.credit_transactions AS ct
  WHERE ct.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.brand_id IS DISTINCT FROM p_brand_id
       OR v_existing.type IS DISTINCT FROM 'grant'::public.credit_transaction_type
       OR v_existing.amount IS DISTINCT FROM p_amount THEN
      RAISE EXCEPTION 'Idempotency key conflict'
        USING ERRCODE = '23505';
    END IF;

    SELECT *
    INTO v_balance
    FROM public.brand_credit_balances AS bcb
    WHERE bcb.brand_id = p_brand_id;

    RETURN QUERY
    SELECT
      v_existing.id,
      v_balance.brand_id,
      v_balance.granted_credits,
      v_balance.reserved_credits,
      v_balance.consumed_credits,
      v_balance.granted_credits - v_balance.reserved_credits - v_balance.consumed_credits,
      false;

    RETURN;
  END IF;

  INSERT INTO public.brand_credit_balances (brand_id)
  VALUES (p_brand_id)
  ON CONFLICT ON CONSTRAINT brand_credit_balances_pkey DO NOTHING;

  SELECT *
  INTO v_balance
  FROM public.brand_credit_balances AS bcb
  WHERE bcb.brand_id = p_brand_id
  FOR UPDATE;

  UPDATE public.brand_credit_balances AS bcb
  SET granted_credits = bcb.granted_credits + p_amount
  WHERE bcb.brand_id = p_brand_id
  RETURNING * INTO v_balance;

  BEGIN
    INSERT INTO public.credit_transactions (
      brand_id,
      type,
      amount,
      idempotency_key,
      metadata
    )
    VALUES (
      p_brand_id,
      'grant'::public.credit_transaction_type,
      p_amount,
      p_idempotency_key,
      v_metadata
    )
    RETURNING id INTO v_transaction_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT *
      INTO v_existing
      FROM public.credit_transactions AS ct
      WHERE ct.idempotency_key = p_idempotency_key;

      IF v_existing.brand_id IS DISTINCT FROM p_brand_id
         OR v_existing.type IS DISTINCT FROM 'grant'::public.credit_transaction_type
         OR v_existing.amount IS DISTINCT FROM p_amount THEN
        RAISE EXCEPTION 'Idempotency key conflict'
          USING ERRCODE = '23505';
      END IF;

      SELECT *
      INTO v_balance
      FROM public.brand_credit_balances AS bcb
      WHERE bcb.brand_id = p_brand_id;

      RETURN QUERY
      SELECT
        v_existing.id,
        v_balance.brand_id,
        v_balance.granted_credits,
        v_balance.reserved_credits,
        v_balance.consumed_credits,
        v_balance.granted_credits - v_balance.reserved_credits - v_balance.consumed_credits,
        false;

      RETURN;
  END;

  RETURN QUERY
  SELECT
    v_transaction_id,
    v_balance.brand_id,
    v_balance.granted_credits,
    v_balance.reserved_credits,
    v_balance.consumed_credits,
    v_balance.granted_credits - v_balance.reserved_credits - v_balance.consumed_credits,
    true;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_brand_credits(uuid, integer, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_brand_credits(uuid, integer, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.grant_brand_credits(uuid, integer, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.grant_brand_credits(uuid, integer, text, jsonb) TO service_role;
