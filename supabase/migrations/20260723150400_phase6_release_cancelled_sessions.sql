-- Phase 6 fix: allow credit release for cancelled sessions that still hold reservations

CREATE OR REPLACE FUNCTION public.release_reserved_brand_credits(p_session_id uuid)
RETURNS TABLE (
  session_id uuid,
  brand_id uuid,
  status public.try_on_session_status,
  credit_cost integer,
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
  v_session public.try_on_sessions%ROWTYPE;
  v_balance public.brand_credit_balances%ROWTYPE;
  v_existing public.credit_transactions%ROWTYPE;
  v_idempotency_key text;
  v_cost integer;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Session is required'
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := 'session:' || p_session_id::text || ':release';

  PERFORM pg_advisory_xact_lock(hashtext('release_reserved_brand_credits:' || p_session_id::text));

  SELECT *
  INTO v_session
  FROM public.try_on_sessions AS s
  WHERE s.id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.credit_transactions AS ct
  WHERE ct.idempotency_key = v_idempotency_key;

  IF FOUND THEN
    IF v_existing.brand_id IS DISTINCT FROM v_session.brand_id
       OR v_existing.type IS DISTINCT FROM 'release'::public.credit_transaction_type
       OR v_existing.session_id IS DISTINCT FROM p_session_id THEN
      RAISE EXCEPTION 'Idempotency key conflict'
        USING ERRCODE = '23505';
    END IF;

    SELECT *
    INTO v_balance
    FROM public.brand_credit_balances AS bcb
    WHERE bcb.brand_id = v_session.brand_id;

    RETURN QUERY
    SELECT
      v_session.id,
      v_session.brand_id,
      v_session.status,
      v_session.credit_cost,
      v_balance.granted_credits,
      v_balance.reserved_credits,
      v_balance.consumed_credits,
      v_balance.granted_credits - v_balance.reserved_credits - v_balance.consumed_credits,
      false;

    RETURN;
  END IF;

  IF v_session.status = 'completed'::public.try_on_session_status THEN
    RAISE EXCEPTION 'Completed sessions cannot release credits'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.credit_transactions AS ct
    WHERE ct.session_id = p_session_id
      AND ct.type = 'consume'::public.credit_transaction_type
  ) THEN
    RAISE EXCEPTION 'Consumed sessions cannot release credits'
      USING ERRCODE = '22023';
  END IF;

  v_cost := COALESCE(v_session.credit_cost, 0);

  IF v_cost <= 0 THEN
    IF v_session.status <> 'cancelled'::public.try_on_session_status THEN
      UPDATE public.try_on_sessions AS s
      SET status = 'failed'::public.try_on_session_status
      WHERE s.id = p_session_id
      RETURNING * INTO v_session;
    END IF;

    SELECT *
    INTO v_balance
    FROM public.brand_credit_balances AS bcb
    WHERE bcb.brand_id = v_session.brand_id;

    RETURN QUERY
    SELECT
      v_session.id,
      v_session.brand_id,
      v_session.status,
      v_session.credit_cost,
      v_balance.granted_credits,
      v_balance.reserved_credits,
      v_balance.consumed_credits,
      v_balance.granted_credits - v_balance.reserved_credits - v_balance.consumed_credits,
      true;

    RETURN;
  END IF;

  IF v_session.status NOT IN (
    'queued'::public.try_on_session_status,
    'processing'::public.try_on_session_status,
    'cancelled'::public.try_on_session_status
  ) THEN
    RAISE EXCEPTION 'Session is not eligible for release'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_balance
  FROM public.brand_credit_balances AS bcb
  WHERE bcb.brand_id = v_session.brand_id
  FOR UPDATE;

  IF v_balance.reserved_credits < v_cost THEN
    RAISE EXCEPTION 'Reserved credits are insufficient'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.brand_credit_balances AS bcb
  SET reserved_credits = bcb.reserved_credits - v_cost
  WHERE bcb.brand_id = v_session.brand_id
  RETURNING * INTO v_balance;

  INSERT INTO public.credit_transactions (
    brand_id,
    type,
    amount,
    idempotency_key,
    session_id,
    metadata
  )
  VALUES (
    v_session.brand_id,
    'release'::public.credit_transaction_type,
    v_cost,
    v_idempotency_key,
    p_session_id,
    jsonb_build_object('source', 'release_reserved_brand_credits')
  );

  UPDATE public.try_on_sessions AS s
  SET status = CASE
    WHEN s.status = 'cancelled'::public.try_on_session_status THEN s.status
    ELSE 'failed'::public.try_on_session_status
  END
  WHERE s.id = p_session_id
  RETURNING * INTO v_session;

  RETURN QUERY
  SELECT
    v_session.id,
    v_session.brand_id,
    v_session.status,
    v_session.credit_cost,
    v_balance.granted_credits,
    v_balance.reserved_credits,
    v_balance.consumed_credits,
    v_balance.granted_credits - v_balance.reserved_credits - v_balance.consumed_credits,
    true;
END;
$$;

REVOKE ALL ON FUNCTION public.release_reserved_brand_credits(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_reserved_brand_credits(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.release_reserved_brand_credits(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_reserved_brand_credits(uuid) TO service_role;
