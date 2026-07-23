export const TRY_ON_V1_CREDIT_COST = 1;

export const CUSTOMER_UPLOADS_BUCKET = "customer-uploads";
export const TRY_ON_RESULTS_BUCKET = "try-on-results";

export const PERSON_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const TRY_ON_RESULT_MAX_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 4096;

export const SIGNED_URL_TTL_SECONDS = 15 * 60;

export const INCOMPLETE_SESSION_TTL_HOURS = 24;
export const CONSENT_SESSION_TTL_DAYS = 30;

export const SESSION_ACCESS_COOKIE_PREFIX = "try_on_session_";

export type PersonPhotoExtension = "jpg" | "jpeg" | "png" | "webp";

export const PERSON_PHOTO_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type PersonPhotoMimeType = (typeof PERSON_PHOTO_ALLOWED_MIME_TYPES)[number];

export function mimeTypeToExtension(mimeType: PersonPhotoMimeType): PersonPhotoExtension {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
  }
}
