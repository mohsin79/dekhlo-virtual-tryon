-- Phase 8A.1: admin credit transaction types (values only; constraints in next migration)

ALTER TYPE public.credit_transaction_type ADD VALUE IF NOT EXISTS 'admin_grant';
ALTER TYPE public.credit_transaction_type ADD VALUE IF NOT EXISTS 'admin_revoke';
