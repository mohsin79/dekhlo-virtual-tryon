export const PRODUCT_IMAGES_BUCKET = "product-images";

export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const PRODUCT_IMAGE_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type ProductImageMimeType = (typeof PRODUCT_IMAGE_ALLOWED_MIME_TYPES)[number];

export const PRODUCT_IMAGE_EXTENSIONS: Record<ProductImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
