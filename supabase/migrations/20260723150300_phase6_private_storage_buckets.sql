-- Phase 6: private customer-uploads and try-on-results buckets

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'customer-uploads',
  'customer-uploads',
  false,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'try-on-results',
  'try-on-results',
  false,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
);

CREATE OR REPLACE FUNCTION public.is_valid_customer_upload_path(object_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT object_path ~ (
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || 'person\.(jpg|jpeg|png|webp)$'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_valid_try_on_result_path(object_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT object_path ~ (
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || 'result\.png$'
  );
$$;

REVOKE ALL ON FUNCTION public.is_valid_customer_upload_path(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_valid_try_on_result_path(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_valid_customer_upload_path(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_try_on_result_path(text) TO service_role;

-- Private buckets: no broad anon/authenticated Storage policies.
-- Trusted server routes use the service role for signed URLs and object writes.
