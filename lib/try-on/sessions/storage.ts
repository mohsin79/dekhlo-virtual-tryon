import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  CUSTOMER_UPLOADS_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  TRY_ON_RESULTS_BUCKET,
} from "@/lib/try-on/sessions/constants";

export async function createSignedUploadUrl(
  bucket: string,
  path: string,
): Promise<{ signedUrl: string; token: string } | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);

  if (error || !data) {
    return null;
  }

  return { signedUrl: data.signedUrl, token: data.token };
}

export async function createSignedReadUrl(
  bucket: string,
  path: string,
  expiresIn = SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);

  if (error || !data) {
    return null;
  }

  return data.signedUrl;
}

export async function downloadPrivateObject(bucket: string, path: string): Promise<Buffer | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.from(bucket).download(path);

  if (error || !data) {
    return null;
  }

  return Buffer.from(await data.arrayBuffer());
}

export async function uploadPrivateObject(
  bucket: string,
  path: string,
  body: Buffer,
  contentType: string,
): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase.storage.from(bucket).upload(path, body, {
    contentType,
    upsert: true,
  });

  return !error;
}

export async function removePrivateObject(bucket: string, path: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase.storage.from(bucket).remove([path]);
}

export async function createPersonUploadUrl(path: string) {
  return createSignedUploadUrl(CUSTOMER_UPLOADS_BUCKET, path);
}

export async function createPersonReadUrl(path: string) {
  return createSignedReadUrl(CUSTOMER_UPLOADS_BUCKET, path);
}

export async function createResultReadUrl(path: string) {
  return createSignedReadUrl(TRY_ON_RESULTS_BUCKET, path);
}

export async function downloadPersonPhoto(path: string) {
  return downloadPrivateObject(CUSTOMER_UPLOADS_BUCKET, path);
}

export async function uploadTryOnResult(path: string, body: Buffer) {
  return uploadPrivateObject(TRY_ON_RESULTS_BUCKET, path, body, "image/png");
}

export async function removeTryOnResult(path: string) {
  return removePrivateObject(TRY_ON_RESULTS_BUCKET, path);
}

export async function removePersonPhoto(path: string) {
  return removePrivateObject(CUSTOMER_UPLOADS_BUCKET, path);
}
