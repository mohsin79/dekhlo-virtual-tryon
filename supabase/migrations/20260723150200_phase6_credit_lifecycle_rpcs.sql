-- Phase 6: session-linked credit lifecycle RPCs

CREATE OR REPLACE FUNCTION public.queue_try_on_session(p_session_id uuid)
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
  v_cost integer;
  v_idempotency_key text;
  v_available integer;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Session is required'
      USING ERRCODE = '22023';
  END IF;

  v_cost := public.try_on_v1_credit_cost();
  v_idempotency_key := 'session:' || p_session_id::text || ':reserve';

  PERFORM pg_advisory_xact_lock(hashtext('queue_try_on_session:' || p_session_id::text));

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
       OR v_existing.type IS DISTINCT FROM 'reserve'::public.credit_transaction_type
       OR v_existing.amount IS DISTINCT FROM v_cost
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

  IF v_session.status IS DISTINCT FROM 'pending_upload'::public.try_on_session_status THEN
    RAISE EXCEPTION 'Session is not pending upload'
      USING ERRCODE = '22023';
  END IF;

  IF v_session.upload_validated_at IS NULL THEN
    RAISE EXCEPTION 'Upload has not been validated'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.products AS p
    WHERE p.id = v_session.product_id
      AND p.brand_id = v_session.brand_id
      AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'Product is not active'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.brand_credit_balances (brand_id)
  VALUES (v_session.brand_id)
  ON CONFLICT ON CONSTRAINT brand_credit_balances_pkey DO NOTHING;

  SELECT *
  INTO v_balance
  FROM public.brand_credit_balances AS bcb
  WHERE bcb.brand_id = v_session.brand_id
  FOR UPDATE;

  v_available := v_balance.granted_credits - v_balance.reserved_credits - v_balance.consumed_credits;

  IF v_available < v_cost THEN
    RAISE EXCEPTION 'Insufficient credits'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.brand_credit_balances AS bcb
  SET reserved_credits = bcb.reserved_credits + v_cost
  WHERE bcb.brand_id = v_session.brand_id
  RETURNING * INTO v_balance;

  BEGIN
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
      'reserve'::public.credit_transaction_type,
      v_cost,
      v_idempotency_key,
      p_session_id,
      jsonb_build_object('source', 'queue_try_on_session')
    );
  EXCEPTION
    WHEN unique_violation THEN
      SELECT *
      INTO v_existing
      FROM public.credit_transactions AS ct
      WHERE ct.idempotency_key = v_idempotency_key;

      IF v_existing.brand_id IS DISTINCT FROM v_session.brand_id
         OR v_existing.type IS DISTINCT FROM 'reserve'::public.credit_transaction_type
         OR v_existing.amount IS DISTINCT FROM v_cost
         OR v_existing.session_id IS DISTINCT FROM p_session_id THEN
        RAISE EXCEPTION 'Idempotency key conflict'
          USING ERRCODE = '23505';
      END IF;

      SELECT *
      INTO v_balance
      FROM public.brand_credit_balances AS bcb
      WHERE bcb.brand_id = v_session.brand_id;

      SELECT *
      INTO v_session
      FROM public.try_on_sessions AS s
      WHERE s.id = p_session_id;

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
  END;

  UPDATE public.try_on_sessions AS s
  SET
    credit_cost = v_cost,
    status = 'queued'::public.try_on_session_status
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

CREATE OR REPLACE FUNCTION public.consume_reserved_brand_credits(p_session_id uuid)
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

  v_idempotency_key := 'session:' || p_session_id::text || ':consume';

  PERFORM pg_advisory_xact_lock(hashtext('consume_reserved_brand_credits:' || p_session_id::text));

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
       OR v_existing.type IS DISTINCT FROM 'consume'::public.credit_transaction_type
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

  v_cost := v_session.credit_cost;

  IF v_cost IS NULL OR v_cost <= 0 THEN
    RAISE EXCEPTION 'Session has no reserved credit cost'
      USING ERRCODE = '22023';
  END IF;

  IF v_session.result_storage_path IS NULL OR btrim(v_session.result_storage_path) = '' THEN
    RAISE EXCEPTION 'Result storage path is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_session.status NOT IN (
    'processing'::public.try_on_session_status,
    'queued'::public.try_on_session_status
  ) THEN
    RAISE EXCEPTION 'Session is not eligible for consumption'
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
  SET
    reserved_credits = bcb.reserved_credits - v_cost,
    consumed_credits = bcb.consumed_credits + v_cost
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
    'consume'::public.credit_transaction_type,
    v_cost,
    v_idempotency_key,
    p_session_id,
    jsonb_build_object('source', 'consume_reserved_brand_credits')
  );

  UPDATE public.try_on_sessions AS s
  SET
    status = 'completed'::public.try_on_session_status,
    completed_at = now(),
    expires_at = CASE
      WHEN s.consent_to_store THEN now() + interval '30 days'
      ELSE now() + interval '24 hours'
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
    'processing'::public.try_on_session_status
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

REVOKE ALL ON FUNCTION public.queue_try_on_session(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.queue_try_on_session(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.queue_try_on_session(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.queue_try_on_session(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.consume_reserved_brand_credits(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_reserved_brand_credits(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.consume_reserved_brand_credits(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_reserved_brand_credits(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.release_reserved_brand_credits(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_reserved_brand_credits(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.release_reserved_brand_credits(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_reserved_brand_credits(uuid) TO service_role;
