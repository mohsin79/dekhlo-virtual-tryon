import {
  MAX_IMAGE_DIMENSION,
  PERSON_PHOTO_ALLOWED_MIME_TYPES,
  PERSON_PHOTO_MAX_BYTES,
  type PersonPhotoMimeType,
} from "@/lib/try-on/sessions/constants";

export type ValidatedPersonPhoto = {
  buffer: Buffer;
  mimeType: PersonPhotoMimeType;
  width: number;
  height: number;
  size: number;
};

export type PersonPhotoValidationError = {
  code: string;
  message: string;
};

function detectMimeType(buffer: Buffer): PersonPhotoMimeType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
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

function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      return null;
    }

    const marker = buffer[offset + 1];
    const blockLength = buffer.readUInt16BE(offset + 2);

    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf
    ) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + blockLength;
  }

  return null;
}

function readWebpDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 30) {
    return null;
  }

  const chunk = buffer.toString("ascii", 12, 16);

  if (chunk === "VP8X" && buffer.length >= 30) {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { width, height };
  }

  if (chunk === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunk === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }

  return null;
}

function readImageDimensions(
  buffer: Buffer,
  mimeType: PersonPhotoMimeType,
): { width: number; height: number } | null {
  switch (mimeType) {
    case "image/png":
      return readPngDimensions(buffer);
    case "image/jpeg":
      return readJpegDimensions(buffer);
    case "image/webp":
      return readWebpDimensions(buffer);
  }
}

export function validatePersonPhotoBuffer(
  buffer: Buffer,
  declaredType?: string | null,
): { ok: true; value: ValidatedPersonPhoto } | { ok: false; error: PersonPhotoValidationError } {
  if (!buffer.length) {
    return { ok: false, error: { code: "EMPTY_FILE", message: "Uploaded file is empty." } };
  }

  if (buffer.length > PERSON_PHOTO_MAX_BYTES) {
    return {
      ok: false,
      error: { code: "FILE_TOO_LARGE", message: "Image must be 8 MB or smaller." },
    };
  }

  const detectedType = detectMimeType(buffer);

  if (!detectedType || !PERSON_PHOTO_ALLOWED_MIME_TYPES.includes(detectedType)) {
    return {
      ok: false,
      error: { code: "UNSUPPORTED_FORMAT", message: "Only JPEG, PNG and WebP images are allowed." },
    };
  }

  if (
    declaredType &&
    PERSON_PHOTO_ALLOWED_MIME_TYPES.includes(declaredType as PersonPhotoMimeType) &&
    declaredType !== detectedType
  ) {
    return {
      ok: false,
      error: { code: "MIME_MISMATCH", message: "Image type does not match file contents." },
    };
  }

  const dimensions = readImageDimensions(buffer, detectedType);

  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return {
      ok: false,
      error: { code: "INVALID_IMAGE", message: "Image dimensions could not be validated." },
    };
  }

  if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) {
    return {
      ok: false,
      error: {
        code: "DIMENSIONS_TOO_LARGE",
        message: `Image dimensions must be ${MAX_IMAGE_DIMENSION}px or smaller.`,
      },
    };
  }

  return {
    ok: true,
    value: {
      buffer,
      mimeType: detectedType,
      width: dimensions.width,
      height: dimensions.height,
      size: buffer.length,
    },
  };
}
