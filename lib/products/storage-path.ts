import { randomUUID } from "crypto";
import { PRODUCT_IMAGE_EXTENSIONS, type ProductImageMimeType } from "@/lib/products/constants";

export function buildProductImageStoragePath(
  brandId: string,
  productId: string,
  mimeType: ProductImageMimeType,
): string {
  const fileId = randomUUID();
  const extension = PRODUCT_IMAGE_EXTENSIONS[mimeType];
  return `${brandId}/${productId}/${fileId}.${extension}`;
}

export function isSafeProductImagePath(path: string | null | undefined): path is string {
  if (!path?.trim()) {
    return false;
  }

  const value = path.trim();

  if (value.includes("://") || value.includes("..") || value.startsWith("/")) {
    return false;
  }

  return /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/i.test(value);
}
