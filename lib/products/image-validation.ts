import {
  PRODUCT_IMAGE_ALLOWED_MIME_TYPES,
  PRODUCT_IMAGE_MAX_BYTES,
  type ProductImageMimeType,
} from "@/lib/products/constants";

export type ValidatedProductImage = {
  buffer: Buffer;
  mimeType: ProductImageMimeType;
  size: number;
};

export type ProductImageValidationError = {
  message: string;
};

function detectMimeType(buffer: Buffer): ProductImageMimeType | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

export async function validateProductImageFile(
  file: File | null | undefined,
  options?: { required?: boolean },
): Promise<{ ok: true; value: ValidatedProductImage } | { ok: false; error: ProductImageValidationError }> {
  const required = options?.required ?? true;

  if (!file || file.size === 0) {
    if (!required) {
      return { ok: false, error: { message: "No image provided." } };
    }

    return { ok: false, error: { message: "Product image is required." } };
  }

  if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
    return { ok: false, error: { message: "Image must be 5 MB or smaller." } };
  }

  const declaredType = file.type as ProductImageMimeType;

  if (!PRODUCT_IMAGE_ALLOWED_MIME_TYPES.includes(declaredType)) {
    return { ok: false, error: { message: "Only JPEG, PNG and WebP images are allowed." } };
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const detectedType = detectMimeType(buffer);

  if (!detectedType) {
    return { ok: false, error: { message: "Image file content is not a supported format." } };
  }

  if (detectedType !== declaredType) {
    return { ok: false, error: { message: "Image type does not match file contents." } };
  }

  return {
    ok: true,
    value: {
      buffer,
      mimeType: detectedType,
      size: buffer.length,
    },
  };
}
