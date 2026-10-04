import { isValidTryOnSessionId } from "@/lib/try-on/sessions/session-restoration";
import { isSessionAccessTokenShape } from "@/lib/embed/session-presentation";

export const EMBED_SESSION_STORAGE_PREFIX = "dekhlo-embed-session:";

export type EmbedSessionCredential = {
  sessionId: string;
  token: string;
};

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function embedSessionStorageKey(brandSlug: string, productSlug: string): string {
  return `${EMBED_SESSION_STORAGE_PREFIX}${brandSlug}:${productSlug}`;
}

function browserSessionStorage(): KeyValueStorage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readEmbedSessionCredential(
  brandSlug: string,
  productSlug: string,
  storage: KeyValueStorage | null = browserSessionStorage(),
): EmbedSessionCredential | null {
  if (!storage) {
    return null;
  }

  let raw: string | null;

  try {
    raw = storage.getItem(embedSessionStorageKey(brandSlug, productSlug));
  } catch {
    return null;
  }

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { sessionId?: unknown; token?: unknown };

    if (typeof parsed.sessionId !== "string" || typeof parsed.token !== "string") {
      return null;
    }

    if (!isValidTryOnSessionId(parsed.sessionId) || !isSessionAccessTokenShape(parsed.token)) {
      return null;
    }

    return { sessionId: parsed.sessionId, token: parsed.token };
  } catch {
    return null;
  }
}

export function writeEmbedSessionCredential(
  brandSlug: string,
  productSlug: string,
  credential: EmbedSessionCredential,
  storage: KeyValueStorage | null = browserSessionStorage(),
): void {
  if (!storage) {
    return;
  }

  if (!isValidTryOnSessionId(credential.sessionId) || !isSessionAccessTokenShape(credential.token)) {
    return;
  }

  try {
    storage.setItem(
      embedSessionStorageKey(brandSlug, productSlug),
      JSON.stringify({ sessionId: credential.sessionId, token: credential.token }),
    );
  } catch {
    // Ignore storage failures. The in-memory token still covers this attempt.
  }
}

export function clearEmbedSessionCredential(
  brandSlug: string,
  productSlug: string,
  storage: KeyValueStorage | null = browserSessionStorage(),
): void {
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(embedSessionStorageKey(brandSlug, productSlug));
  } catch {
    // Ignore storage failures.
  }
}
