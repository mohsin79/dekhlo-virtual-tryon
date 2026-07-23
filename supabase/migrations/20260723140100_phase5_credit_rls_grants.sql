-- Phase 5: credit table grants and RLS

REVOKE ALL ON TABLE public.brand_credit_balances FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.credit_transactions FROM PUBLIC, anon, authenticated;

GRANT USAGE ON TYPE public.credit_transaction_type TO authenticated, service_role;

GRANT SELECT ON TABLE public.brand_credit_balances TO authenticated;
GRANT SELECT ON TABLE public.credit_transactions TO authenticated;

GRANT ALL ON TABLE public.brand_credit_balances TO service_role;
GRANT ALL ON TABLE public.credit_transactions TO service_role;

ALTER TABLE public.brand_credit_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_credit_balances_select_finance_roles
  ON public.brand_credit_balances
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

CREATE POLICY credit_transactions_select_finance_roles
  ON public.credit_transactions
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
