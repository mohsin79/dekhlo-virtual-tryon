-- Phase 5: credit balance and transaction schema

CREATE TYPE public.credit_transaction_type AS ENUM (
  'grant',
  'reserve',
  'consume',
  'release'
);

CREATE TABLE public.brand_credit_balances (
  brand_id uuid PRIMARY KEY REFERENCES public.brands (id) ON DELETE CASCADE,
  granted_credits integer NOT NULL DEFAULT 0,
  reserved_credits integer NOT NULL DEFAULT 0,
  consumed_credits integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_credit_balances_granted_non_negative_chk
    CHECK (granted_credits >= 0),
  CONSTRAINT brand_credit_balances_reserved_non_negative_chk
    CHECK (reserved_credits >= 0),
  CONSTRAINT brand_credit_balances_consumed_non_negative_chk
    CHECK (consumed_credits >= 0),
  CONSTRAINT brand_credit_balances_available_non_negative_chk
    CHECK (granted_credits >= reserved_credits + consumed_credits)
);

CREATE TRIGGER brand_credit_balances_set_updated_at
BEFORE UPDATE ON public.brand_credit_balances
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  type public.credit_transaction_type NOT NULL,
  amount integer NOT NULL,
  idempotency_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_transactions_amount_positive_chk CHECK (amount > 0),
  CONSTRAINT credit_transactions_idempotency_key_not_empty_chk CHECK (btrim(idempotency_key) <> ''),
  CONSTRAINT credit_transactions_idempotency_key_length_chk CHECK (char_length(idempotency_key) <= 128),
  CONSTRAINT credit_transactions_metadata_object_chk CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX credit_transactions_idempotency_key_key ON public.credit_transactions (idempotency_key);
CREATE INDEX credit_transactions_brand_id_idx ON public.credit_transactions (brand_id);
CREATE INDEX credit_transactions_brand_created_at_idx ON public.credit_transactions (brand_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_credit_transaction_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Credit transactions are append-only'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER credit_transactions_prevent_update
BEFORE UPDATE ON public.credit_transactions
FOR EACH ROW
EXECUTE FUNCTION public.prevent_credit_transaction_mutation();

CREATE TRIGGER credit_transactions_prevent_delete
BEFORE DELETE ON public.credit_transactions
FOR EACH ROW
EXECUTE FUNCTION public.prevent_credit_transaction_mutation();

CREATE OR REPLACE FUNCTION public.initialize_brand_credit_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.brand_credit_balances (brand_id)
  VALUES (NEW.id)
  ON CONFLICT (brand_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_brand_credit_balance() FROM PUBLIC;

CREATE TRIGGER brands_initialize_credit_balance
AFTER INSERT ON public.brands
FOR EACH ROW
EXECUTE FUNCTION public.initialize_brand_credit_balance();

INSERT INTO public.brand_credit_balances (brand_id)
SELECT b.id
FROM public.brands AS b
ON CONFLICT (brand_id) DO NOTHING;
