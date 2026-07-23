import "server-only";

import { createClient } from "@/lib/supabase/server";
import { PRODUCT_IMAGES_BUCKET } from "@/lib/products/constants";
import { isSafeProductImagePath } from "@/lib/products/storage-path";

export async function getProductImagePublicUrl(
  relativePath: string | null | undefined,
): Promise<string | null> {
  if (!isSafeProductImagePath(relativePath)) {
    return null;
  }

  const supabase = await createClient();
  const { data } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(relativePath);
  return data.publicUrl;
}
