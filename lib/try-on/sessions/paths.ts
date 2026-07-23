import type { PersonPhotoExtension } from "@/lib/try-on/sessions/constants";

export function buildPersonStoragePath(
  brandId: string,
  sessionId: string,
  extension: PersonPhotoExtension,
): string {
  return `${brandId}/${sessionId}/person.${extension}`;
}

export function buildResultStoragePath(brandId: string, sessionId: string): string {
  return `${brandId}/${sessionId}/result.png`;
}

export function isSafePersonStoragePath(path: string): boolean {
  return /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/person\.(jpg|jpeg|png|webp)$/.test(path);
}

export function isSafeResultStoragePath(path: string): boolean {
  return /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/result\.png$/.test(path);
}
