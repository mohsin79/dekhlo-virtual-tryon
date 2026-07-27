-- Phase 8A.1: platform-admin credit grant and revoke RPCs

ALTER TABLE public.credit_transactions
  DROP CONSTRAINT credit_transactions_grant_no_session_chk;

ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_non_session_types_no_session_chk
    CHECK (
      type NOT IN (
        'grant'::public.credit_transaction_type,
        'admin_grant'::public.credit_transaction_type,
        'admin_revoke'::public.credit_transaction_type
      )
      OR session_id IS NULL
    );

CREATE OR REPLACE FUNCTION public.admin_grant_brand_credits(
  p_brand_id uuid,
  p_amount integer,
  p_idempotency_key text,
  p_reason text,
  p_actor uuid
)
RETURNS TABLE (
  transaction_id uuid,
  audit_log_id uuid,
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
  v_reason text;
  v_existing public.credit_transactions%ROWTYPE;
  v_existing_audit public.audit_logs%ROWTYPE;
  v_balance public.brand_credit_balances%ROWTYPE;
  v_transaction_id uuid;
  v_audit_log_id uuid;
  v_metadata jsonb;
BEGIN
  v_reason := btrim(COALESCE(p_reason, ''));

  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Actor is required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_actor
  ) THEN
    RAISE EXCEPTION 'Actor profile not found'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_actor
      AND p.platform_role = 'platform_admin'::public.platform_role
  ) THEN
    RAISE EXCEPTION 'Platform administrator authorization required'
      USING ERRCODE = '42501';
  END IF;

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

  IF v_reason = '' THEN
    RAISE EXCEPTION 'Reason is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Reason is too long'
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

  PERFORM pg_advisory_xact_lock(hashtext('admin_grant_brand_credits:' || p_idempotency_key));

  SELECT *
  INTO v_existing
  FROM public.credit_transactions AS ct
  WHERE ct.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    SELECT *
    INTO v_existing_audit
    FROM public.audit_logs AS al
    WHERE al.idempotency_key = p_idempotency_key;

    IF NOT FOUND
       OR v_existing.brand_id IS DISTINCT FROM p_brand_id
       OR v_existing.type IS DISTINCT FROM 'admin_grant'::public.credit_transaction_type
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.metadata ->> 'actor_user_id' IS DISTINCT FROM p_actor::text
       OR v_existing.metadata ->> 'reason' IS DISTINCT FROM v_reason
       OR v_existing_audit.action IS DISTINCT FROM 'credit.admin_grant'
       OR v_existing_audit.actor_user_id IS DISTINCT FROM p_actor
       OR v_existing_audit.brand_id IS DISTINCT FROM p_brand_id
       OR v_existing_audit.reason IS DISTINCT FROM v_reason THEN
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
      v_existing_audit.id,
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

  v_metadata := jsonb_build_object(
    'actor_user_id', p_actor::text,
    'reason', v_reason,
    'operation', 'admin_grant'
  );

  INSERT INTO public.credit_transactions (
    brand_id,
    type,
    amount,
    idempotency_key,
    metadata
  )
  VALUES (
    p_brand_id,
    'admin_grant'::public.credit_transaction_type,
    p_amount,
    p_idempotency_key,
    v_metadata
  )
  RETURNING id INTO v_transaction_id;

  INSERT INTO public.audit_logs (
    action,
    actor_user_id,
    brand_id,
    target_type,
    target_id,
    reason,
    idempotency_key,
    metadata
  )
  VALUES (
    'credit.admin_grant',
    p_actor,
    p_brand_id,
    'credit_transaction',
    v_transaction_id,
    v_reason,
    p_idempotency_key,
    jsonb_build_object(
      'amount', p_amount,
      'transaction_type', 'admin_grant'
    )
  )
  RETURNING id INTO v_audit_log_id;

  RETURN QUERY
  SELECT
    v_transaction_id,
    v_audit_log_id,
    v_balance.brand_id,
    v_balance.granted_credits,
    v_balance.reserved_credits,
    v_balance.consumed_credits,
    v_balance.granted_credits - v_balance.reserved_credits - v_balance.consumed_credits,
    true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_brand_credits(
  p_brand_id uuid,
  p_amount integer,
  p_idempotency_key text,
  p_reason text,
  p_actor uuid
)
RETURNS TABLE (
  transaction_id uuid,
  audit_log_id uuid,
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
  v_reason text;
  v_existing public.credit_transactions%ROWTYPE;
  v_existing_audit public.audit_logs%ROWTYPE;
  v_balance public.brand_credit_balances%ROWTYPE;
  v_transaction_id uuid;
  v_audit_log_id uuid;
  v_metadata jsonb;
BEGIN
  v_reason := btrim(COALESCE(p_reason, ''));

  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Actor is required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_actor
  ) THEN
    RAISE EXCEPTION 'Actor profile not found'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_actor
      AND p.platform_role = 'platform_admin'::public.platform_role
  ) THEN
    RAISE EXCEPTION 'Platform administrator authorization required'
      USING ERRCODE = '42501';
  END IF;

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

  IF v_reason = '' THEN
    RAISE EXCEPTION 'Reason is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Reason is too long'
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

  PERFORM pg_advisory_xact_lock(hashtext('admin_revoke_brand_credits:' || p_idempotency_key));

  SELECT *
  INTO v_existing
  FROM public.credit_transactions AS ct
  WHERE ct.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    SELECT *
    INTO v_existing_audit
    FROM public.audit_logs AS al
    WHERE al.idempotency_key = p_idempotency_key;

    IF NOT FOUND
       OR v_existing.brand_id IS DISTINCT FROM p_brand_id
       OR v_existing.type IS DISTINCT FROM 'admin_revoke'::public.credit_transaction_type
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.metadata ->> 'actor_user_id' IS DISTINCT FROM p_actor::text
       OR v_existing.metadata ->> 'reason' IS DISTINCT FROM v_reason
       OR v_existing_audit.action IS DISTINCT FROM 'credit.admin_revoke'
       OR v_existing_audit.actor_user_id IS DISTINCT FROM p_actor
       OR v_existing_audit.brand_id IS DISTINCT FROM p_brand_id
       OR v_existing_audit.reason IS DISTINCT FROM v_reason THEN
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
      v_existing_audit.id,
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

  IF v_balance.granted_credits - p_amount < v_balance.reserved_credits + v_balance.consumed_credits THEN
    RAISE EXCEPTION 'Insufficient granted credits to revoke'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.brand_credit_balances AS bcb
  SET granted_credits = bcb.granted_credits - p_amount
  WHERE bcb.brand_id = p_brand_id
  RETURNING * INTO v_balance;

  v_metadata := jsonb_build_object(
    'actor_user_id', p_actor::text,
    'reason', v_reason,
    'operation', 'admin_revoke'
  );

  INSERT INTO public.credit_transactions (
    brand_id,
    type,
    amount,
    idempotency_key,
    metadata
  )
  VALUES (
    p_brand_id,
    'admin_revoke'::public.credit_transaction_type,
    p_amount,
    p_idempotency_key,
    v_metadata
  )
  RETURNING id INTO v_transaction_id;

  INSERT INTO public.audit_logs (
    action,
    actor_user_id,
    brand_id,
    target_type,
    target_id,
    reason,
    idempotency_key,
    metadata
  )
  VALUES (
    'credit.admin_revoke',
    p_actor,
    p_brand_id,
    'credit_transaction',
    v_transaction_id,
    v_reason,
    p_idempotency_key,
    jsonb_build_object(
      'amount', p_amount,
      'transaction_type', 'admin_revoke'
    )
  )
  RETURNING id INTO v_audit_log_id;

  RETURN QUERY
  SELECT
    v_transaction_id,
    v_audit_log_id,
    v_balance.brand_id,
    v_balance.granted_credits,
    v_balance.reserved_credits,
    v_balance.consumed_credits,
    v_balance.granted_credits - v_balance.reserved_credits - v_balance.consumed_credits,
    true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_brand_credits(uuid, integer, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_grant_brand_credits(uuid, integer, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_grant_brand_credits(uuid, integer, text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_brand_credits(uuid, integer, text, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.admin_revoke_brand_credits(uuid, integer, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_revoke_brand_credits(uuid, integer, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_revoke_brand_credits(uuid, integer, text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_brand_credits(uuid, integer, text, text, uuid) TO service_role;

GRANT USAGE ON TYPE public.platform_role TO authenticated, service_role;
