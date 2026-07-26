export const DUPLICATE_COMPLETED_PHOTO_MESSAGE =
  "This is the same photo you just used for this product. Please choose a different photo.";

export type CompletedPhotoFingerprint = {
  fingerprint: string;
  productKey: string;
};

export async function computePhotoFingerprint(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function isDuplicateOfLastCompletedPhoto(input: {
  fingerprint: string;
  productKey: string;
  lastCompleted: CompletedPhotoFingerprint | null;
}): boolean {
  if (!input.lastCompleted) {
    return false;
  }

  return (
    input.fingerprint === input.lastCompleted.fingerprint &&
    input.productKey === input.lastCompleted.productKey
  );
}
