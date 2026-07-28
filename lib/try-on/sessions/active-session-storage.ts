export const ACTIVE_TRY_ON_STORAGE_PREFIX = "dekhlo-active-try-on:";

export function activeTryOnStorageKey(brandSlug: string, productSlug: string): string {
  return `${ACTIVE_TRY_ON_STORAGE_PREFIX}${brandSlug}:${productSlug}`;
}

export function readActiveTryOnSessionId(brandSlug: string, productSlug: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage.getItem(activeTryOnStorageKey(brandSlug, productSlug));
  } catch {
    return null;
  }
}

export function writeActiveTryOnSessionId(
  brandSlug: string,
  productSlug: string,
  sessionId: string,
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(activeTryOnStorageKey(brandSlug, productSlug), sessionId);
  } catch {
    // Ignore storage failures.
  }
}

export function clearActiveTryOnSessionId(brandSlug: string, productSlug: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(activeTryOnStorageKey(brandSlug, productSlug));
  } catch {
    // Ignore storage failures.
  }
}
