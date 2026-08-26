import { PRODUCT_IMAGES_BUCKET } from "@/lib/products/constants";
import {
  canRemoveProductImagePath,
} from "@/lib/products/storage-path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { captureOperationalMessage } from "@/lib/observability/sentry";

export type RemoveProductImageContext = {
  brandId: string;
  productId: string;
};

export type RemoveProductImageResult =
  | { ok: true }
  | { ok: false; errorCode: string };

export { canRemoveProductImagePath, shouldRemoveReplacedProductImage } from "@/lib/products/storage-path";

export async function removeProductImage(
  supabase: SupabaseClient,
  path: string,
  context: RemoveProductImageContext,
): Promise<RemoveProductImageResult> {
  if (!canRemoveProductImagePath(path, context.brandId, context.productId)) {
    return { ok: false, errorCode: "invalid_path" };
  }

  const { data, error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([path]);

  if (error) {
    return { ok: false, errorCode: error.name || "storage_remove_failed" };
  }

  if (!data || data.length === 0) {
    return { ok: false, errorCode: "storage_object_not_removed" };
  }

  return { ok: true };
}

export function logProductImageCleanupFailure(
  context: RemoveProductImageContext & { productId: string },
  errorCode: string,
): void {
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      `[product-image-cleanup] errorCode=${errorCode}`,
    );
    return;
  }

  captureOperationalMessage("product_image_cleanup_failed", {
    routeCategory: "product_image_cleanup",
    operation: "storage_remove",
    errorCategory: errorCode,
  });
}
