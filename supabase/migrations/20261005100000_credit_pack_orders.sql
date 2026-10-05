-- Merchant credit-pack orders. Credits are granted only through grant_brand_credits
-- after a server-side payment confirmation. Authenticated users may read their
-- brand's orders; they cannot insert or update payment rows.

CREATE TABLE public.credit_pack_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE RESTRICT,
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  pack_id text NOT NULL,
  credits integer NOT NULL,
  amount_paisa integer NOT NULL,
  currency text NOT NULL DEFAULT 'PKR',
  provider text NOT NULL,
  provider_environment text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  provider_tracker text,
  credit_idempotency_key text NOT NULL,
  granted_transaction_id uuid,
  failure_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_pack_orders_pack_id_chk
    CHECK (char_length(btrim(pack_id)) BETWEEN 1 AND 64),
  CONSTRAINT credit_pack_orders_credits_positive_chk
    CHECK (credits > 0),
  CONSTRAINT credit_pack_orders_amount_paisa_positive_chk
    CHECK (amount_paisa > 0),
  CONSTRAINT credit_pack_orders_currency_pkr_chk
    CHECK (currency = 'PKR'),
  CONSTRAINT credit_pack_orders_provider_chk
    CHECK (char_length(btrim(provider)) BETWEEN 1 AND 32),
  CONSTRAINT credit_pack_orders_environment_chk
    CHECK (provider_environment IN ('sandbox', 'production')),
  CONSTRAINT credit_pack_orders_status_chk
    CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),
  CONSTRAINT credit_pack_orders_idempotency_key_chk
    CHECK (
      char_length(credit_idempotency_key) BETWEEN 1 AND 128
    ),
  CONSTRAINT credit_pack_orders_failure_code_chk
    CHECK (
      failure_code IS NULL
      OR (
        char_length(btrim(failure_code)) BETWEEN 1 AND 64
      )
    ),
  CONSTRAINT credit_pack_orders_metadata_object_chk
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT credit_pack_orders_metadata_size_chk
    CHECK (pg_column_size(metadata) <= 4096),
  CONSTRAINT credit_pack_orders_credit_idempotency_key_key
    UNIQUE (credit_idempotency_key)
);

CREATE UNIQUE INDEX credit_pack_orders_provider_tracker_key
  ON public.credit_pack_orders (provider, provider_tracker)
  WHERE provider_tracker IS NOT NULL;

CREATE INDEX credit_pack_orders_brand_created_idx
  ON public.credit_pack_orders (brand_id, created_at DESC, id DESC);

CREATE TRIGGER credit_pack_orders_set_updated_at
BEFORE UPDATE ON public.credit_pack_orders
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

REVOKE ALL ON TABLE public.credit_pack_orders FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.credit_pack_orders TO authenticated;
GRANT ALL ON TABLE public.credit_pack_orders TO service_role;

ALTER TABLE public.credit_pack_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY credit_pack_orders_select_finance_roles
  ON public.credit_pack_orders
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_brand_role(
      brand_id,
      ARRAY[
        'owner'::public.brand_role,
        'admin'::public.brand_role,
        'analyst'::public.brand_role
      ]
    )
  );
