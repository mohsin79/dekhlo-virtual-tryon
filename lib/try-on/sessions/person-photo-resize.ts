import {
  MAX_IMAGE_DIMENSION,
  PERSON_PHOTO_ALLOWED_MIME_TYPES,
  PERSON_PHOTO_MAX_BYTES,
  type PersonPhotoMimeType,
} from "@/lib/try-on/sessions/constants";

export const PERSON_PHOTO_OUTPUT_QUALITY = 0.91;

export const PERSON_PHOTO_OUTPUT_TOO_LARGE_MESSAGE =
  "After optimization, this photo is still too large. Please use a JPEG or WebP image, or choose a smaller photo.";

export const PERSON_PHOTO_OUTPUT_EMPTY_MESSAGE =
  "This photo could not be prepared in your browser. Try another image.";

export type ResizeDimensions = {
  width: number;
  height: number;
  needsResize: boolean;
};

export type PersonPhotoPrepareError = {
  code: string;
  message: string;
};

export type PreparedPersonPhoto = {
  file: File;
  wasResized: boolean;
  width: number;
  height: number;
  mimeType: PersonPhotoMimeType;
};

export type ImageBitmapLike = {
  width: number;
  height: number;
  close: () => void;
};

export type CanvasLike = {
  width: number;
  height: number;
  getContext: (contextId: "2d") => CanvasContextLike | null;
};

export type CanvasContextLike = {
  drawImage: (
    image: ImageBitmapLike,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => void;
};

export type PersonPhotoResizeDeps = {
  createImageBitmap: (
    source: Blob,
    options?: { imageOrientation?: "from-image" | "none" },
  ) => Promise<ImageBitmapLike>;
  createCanvas: (width: number, height: number) => CanvasLike;
  canvasToBlob: (
    canvas: CanvasLike,
    mimeType: PersonPhotoMimeType,
    quality?: number,
  ) => Promise<Blob | null>;
};

export function isSupportedPersonPhotoMimeType(
  mimeType: string,
): mimeType is PersonPhotoMimeType {
  return PERSON_PHOTO_ALLOWED_MIME_TYPES.includes(mimeType as PersonPhotoMimeType);
}

export function validatePersonPhotoFileSize(file: File): PersonPhotoPrepareError | null {
  if (file.size > PERSON_PHOTO_MAX_BYTES) {
    return {
      code: "FILE_TOO_LARGE",
      message: "Image must be 8 MB or smaller.",
    };
  }

  if (file.size === 0) {
    return {
      code: "EMPTY_FILE",
      message: "Uploaded file is empty.",
    };
  }

  return null;
}

export function validatePersonPhotoMimeType(mimeType: string): PersonPhotoPrepareError | null {
  if (!isSupportedPersonPhotoMimeType(mimeType)) {
    return {
      code: "UNSUPPORTED_FORMAT",
      message: "Only JPEG, PNG and WebP images are supported.",
    };
  }

  return null;
}

/** Proportionally fit inside maxDimension × maxDimension without cropping or stretching. */
export function computeResizeDimensions(
  width: number,
  height: number,
  maxDimension = MAX_IMAGE_DIMENSION,
): ResizeDimensions {
  if (width <= 0 || height <= 0) {
    throw new Error("Image dimensions must be positive.");
  }

  if (width <= maxDimension && height <= maxDimension) {
    return { width, height, needsResize: false };
  }

  const scale = maxDimension / Math.max(width, height);

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    needsResize: true,
  };
}

function buildOutputFileName(originalName: string, mimeType: PersonPhotoMimeType): string {
  const baseName = originalName.replace(/\.[^.]+$/, "") || "person-photo";
  switch (mimeType) {
    case "image/jpeg":
      return `${baseName}.jpg`;
    case "image/png":
      return `${baseName}.png`;
    case "image/webp":
      return `${baseName}.webp`;
  }
}

export async function preparePersonPhotoForUpload(
  file: File,
  deps?: Partial<PersonPhotoResizeDeps>,
): Promise<
  { ok: true; value: PreparedPersonPhoto } | { ok: false; error: PersonPhotoPrepareError }
> {
  const sizeError = validatePersonPhotoFileSize(file);

  if (sizeError) {
    return { ok: false, error: sizeError };
  }

  const mimeError = validatePersonPhotoMimeType(file.type);

  if (mimeError) {
    return { ok: false, error: mimeError };
  }

  const mimeType = file.type as PersonPhotoMimeType;
  const runtimeDeps = resolvePersonPhotoResizeDeps(deps);

  let bitmap: ImageBitmapLike | null = null;

  try {
    bitmap = await runtimeDeps.createImageBitmap(file, { imageOrientation: "from-image" });
    const target = computeResizeDimensions(bitmap.width, bitmap.height);

    if (!target.needsResize) {
      return {
        ok: true,
        value: {
          file,
          wasResized: false,
          width: bitmap.width,
          height: bitmap.height,
          mimeType,
        },
      };
    }

    const canvas = runtimeDeps.createCanvas(target.width, target.height);
    const context = canvas.getContext("2d");

    if (!context) {
      return {
        ok: false,
        error: {
          code: "RESIZE_FAILED",
          message: PERSON_PHOTO_OUTPUT_EMPTY_MESSAGE,
        },
      };
    }

    context.drawImage(bitmap, 0, 0, target.width, target.height);
    const blob = await runtimeDeps.canvasToBlob(
      canvas,
      mimeType,
      mimeType === "image/png" ? undefined : PERSON_PHOTO_OUTPUT_QUALITY,
    );

    if (!blob || blob.size === 0) {
      return {
        ok: false,
        error: {
          code: "RESIZE_FAILED",
          message: PERSON_PHOTO_OUTPUT_EMPTY_MESSAGE,
        },
      };
    }

    if (blob.type && blob.type !== mimeType) {
      return {
        ok: false,
        error: {
          code: "RESIZE_FAILED",
          message: PERSON_PHOTO_OUTPUT_EMPTY_MESSAGE,
        },
      };
    }

    if (blob.size > PERSON_PHOTO_MAX_BYTES) {
      return {
        ok: false,
        error: {
          code: "FILE_TOO_LARGE",
          message: PERSON_PHOTO_OUTPUT_TOO_LARGE_MESSAGE,
        },
      };
    }

    const outputFile = new File([blob], buildOutputFileName(file.name, mimeType), {
      type: mimeType,
      lastModified: Date.now(),
    });

    if (outputFile.size === 0) {
      return {
        ok: false,
        error: {
          code: "RESIZE_FAILED",
          message: PERSON_PHOTO_OUTPUT_EMPTY_MESSAGE,
        },
      };
    }

    if (target.width > MAX_IMAGE_DIMENSION || target.height > MAX_IMAGE_DIMENSION) {
      return {
        ok: false,
        error: {
          code: "RESIZE_FAILED",
          message: PERSON_PHOTO_OUTPUT_EMPTY_MESSAGE,
        },
      };
    }

    return {
      ok: true,
      value: {
        file: outputFile,
        wasResized: true,
        width: target.width,
        height: target.height,
        mimeType,
      },
    };
  } catch {
    return {
      ok: false,
      error: {
        code: "RESIZE_FAILED",
        message: PERSON_PHOTO_OUTPUT_EMPTY_MESSAGE,
      },
    };
  } finally {
    bitmap?.close();
  }
}

function resolvePersonPhotoResizeDeps(
  overrides?: Partial<PersonPhotoResizeDeps>,
): PersonPhotoResizeDeps {
  if (typeof document === "undefined" || overrides?.createCanvas) {
    return {
      createImageBitmap:
        overrides?.createImageBitmap ??
        (async () => {
          throw new Error("createImageBitmap is unavailable.");
        }),
      createCanvas:
        overrides?.createCanvas ??
        ((width, height) => {
          throw new Error(`Canvas unavailable (${width}x${height}).`);
        }),
      canvasToBlob:
        overrides?.canvasToBlob ??
        (async () => {
          throw new Error("canvasToBlob is unavailable.");
        }),
    };
  }

  return {
    createImageBitmap:
      overrides?.createImageBitmap ??
      ((source, options) => createImageBitmap(source, options)),
    createCanvas:
      overrides?.createCanvas ??
      ((width, height) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
      }),
    canvasToBlob:
      overrides?.canvasToBlob ??
      ((canvas, type, quality) =>
        new Promise((resolve) => {
          (canvas as HTMLCanvasElement).toBlob(resolve, type, quality);
        })),
  };
}
