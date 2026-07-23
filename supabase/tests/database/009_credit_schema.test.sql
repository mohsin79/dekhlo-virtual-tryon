BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, auth;

SELECT plan(27);

INSERT INTO public.brands (id, name, slug)
VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  'Constraint Brand',
  'constraint-brand'
);

SELECT has_table('public', 'brand_credit_balances', 'brand_credit_balances exists');
SELECT has_table('public', 'credit_transactions', 'credit_transactions exists');

SELECT has_column('public', 'brand_credit_balances', 'brand_id', 'balance brand_id exists');
SELECT has_column('public', 'brand_credit_balances', 'granted_credits', 'balance granted_credits exists');
SELECT has_column('public', 'brand_credit_balances', 'reserved_credits', 'balance reserved_credits exists');
SELECT has_column('public', 'brand_credit_balances', 'consumed_credits', 'balance consumed_credits exists');
SELECT has_column('public', 'brand_credit_balances', 'updated_at', 'balance updated_at exists');

SELECT col_is_pk('public', 'brand_credit_balances', ARRAY['brand_id'], 'balance primary key is brand_id');

SELECT fk_ok(
  'public',
  'brand_credit_balances',
  ARRAY['brand_id'],
  'public',
  'brands',
  ARRAY['id'],
  'balance brand foreign key exists'
);

SELECT ok(
  (
    SELECT confdeltype
    FROM pg_constraint
    WHERE conname = 'brand_credit_balances_brand_id_fkey'
  ) = 'c',
  'balance brand foreign key cascades on brand delete'
);

SELECT col_is_pk('public', 'credit_transactions', ARRAY['id'], 'transaction primary key exists');

SELECT fk_ok(
  'public',
  'credit_transactions',
  ARRAY['brand_id'],
  'public',
  'brands',
  ARRAY['id'],
  'transaction brand foreign key exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'credit_transactions'
      AND column_name = 'session_id'
  ),
  'credit_transactions has session_id column'
);

SELECT is(
  (
    SELECT array_agg(enumlabel ORDER BY enumsortorder)::text[]
    FROM pg_enum
    JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
    WHERE pg_type.typname = 'credit_transaction_type'
  ),
  ARRAY['grant', 'reserve', 'consume', 'release']::text[],
  'credit transaction enum values are exactly grant reserve consume release'
);

SELECT throws_ok(
  $$
    UPDATE public.brand_credit_balances
    SET granted_credits = -1
    WHERE brand_id = '11111111-1111-1111-1111-111111111111'::uuid
  $$,
  '23514',
  NULL,
  'negative granted credits are rejected'
);

SELECT throws_ok(
  $$
    UPDATE public.brand_credit_balances
    SET granted_credits = 5,
        reserved_credits = 3,
        consumed_credits = 3
    WHERE brand_id = '11111111-1111-1111-1111-111111111111'::uuid
  $$,
  '23514',
  NULL,
  'reserved plus consumed greater than granted is rejected'
);

SELECT throws_ok(
  $$
    INSERT INTO public.credit_transactions (brand_id, type, amount, idempotency_key)
    VALUES (
      '11111111-1111-1111-1111-111111111111'::uuid,
      'grant'::public.credit_transaction_type,
      0,
      'zero-amount'
    )
  $$,
  '23514',
  NULL,
  'zero transaction amount is rejected'
);

SELECT has_index('public', 'credit_transactions', 'credit_transactions_idempotency_key_key', 'idempotency unique index exists');
SELECT has_index('public', 'credit_transactions', 'credit_transactions_brand_id_idx', 'brand transaction index exists');
SELECT has_index('public', 'credit_transactions', 'credit_transactions_brand_created_at_idx', 'brand created_at index exists');

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'brand_credit_balances'
  ),
  'RLS is enabled on brand_credit_balances'
);

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'credit_transactions'
  ),
  'RLS is enabled on credit_transactions'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('brand_credit_balances', 'credit_transactions')
      AND cmd = 'ALL'
  ),
  0::bigint,
  'credit tables have no FOR ALL policies'
);

SELECT tests.create_auth_user(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'owner-a@test.local',
  'Owner A'
);

SELECT tests.seed_brand(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Brand A',
  'brand-a',
  '11111111-1111-1111-1111-111111111111'::uuid
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.brand_credit_balances
    WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
  ),
  1::bigint,
  'existing brand receives exactly one balance row'
);

SELECT is(
  (
    SELECT granted_credits
    FROM public.brand_credit_balances
    WHERE brand_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
  ),
  0,
  'existing brand balance defaults to zero granted credits'
);

INSERT INTO public.brands (id, name, slug)
VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  'Brand B',
  'brand-b'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.brand_credit_balances
    WHERE brand_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
  ),
  1::bigint,
  'new brand insertion creates exactly one balance row'
);

INSERT INTO public.brand_credit_balances (brand_id)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid)
ON CONFLICT (brand_id) DO NOTHING;

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.brand_credit_balances
    WHERE brand_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
  ),
  1::bigint,
  'duplicate balance initialization does not create another row'
);

SELECT * FROM finish();

ROLLBACK;
