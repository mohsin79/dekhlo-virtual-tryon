import { isEmbeddableTryOnPath } from "@/lib/embed/paths";

/** Presented by the embed document. Ignored when the httpOnly session cookie is present. */
export const SESSION_ACCESS_HEADER = "x-dekhlo-session-token";

/** Marks a session-create call from the embed document. Not sufficient on its own. */
export const EMBED_TRY_ON_HEADER = "x-dekhlo-embed";

/**
 * `randomBytes(32).toString("base64url")` is 43 characters. Rejecting every
 * other shape keeps a header credential from carrying an unbounded value.
 */
const SESSION_ACCESS_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function isSessionAccessTokenShape(value: string): boolean {
  return SESSION_ACCESS_TOKEN_SHAPE.test(value);
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The cookie remains the credential for the standalone try-on page. A header is
 * accepted only when that cookie is absent, which is the cross-site iframe
 * case: browsers will not send a SameSite=Lax cookie there. A header never
 * replaces a cookie that the browser did send.
 */
export function selectPresentedSessionToken(input: {
  cookieToken: string | null | undefined;
  headerToken: string | null | undefined;
}): string | null {
  const cookieToken = nonEmpty(input.cookieToken);

  if (cookieToken) {
    return cookieToken;
  }

  const headerToken = nonEmpty(input.headerToken);

  if (!headerToken || !isSessionAccessTokenShape(headerToken)) {
    return null;
  }

  return headerToken;
}

function refererPathname(referer: string): string | null {
  try {
    return new URL(referer).pathname;
  } catch {
    return null;
  }
}

function refererHost(referer: string): string | null {
  try {
    return new URL(referer).host;
  } catch {
    return null;
  }
}

/**
 * The session-access token is echoed in JSON only for a real embed document.
 *
 * The embed header is set by our own script, so it is not proof of anything.
 * Browsers set `Referer` and scripts cannot override it. A same-origin request
 * from `/embed/[brand]/[product]` is the only case that receives the token.
 * Origin-only referrers fail closed: we will not guess that a bare origin is
 * the embed document.
 */
export function shouldRevealSessionAccessToken(input: {
  referer: string | null;
  host: string | null;
  embedRequested: boolean;
}): boolean {
  if (!input.embedRequested) {
    return false;
  }

  const referer = input.referer?.trim() ?? "";
  const host = input.host?.trim() ?? "";

  if (!referer || !host) {
    return false;
  }

  const headerHost = refererHost(referer);
  const pathname = refererPathname(referer);

  if (!headerHost || !pathname) {
    return false;
  }

  if (headerHost.toLowerCase() !== host.toLowerCase()) {
    return false;
  }

  return isEmbeddableTryOnPath(pathname);
}

export function buildTryOnSessionCreateHeaders(input: {
  embed: boolean;
  sessionAccessToken: string | null;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (!input.embed) {
    return headers;
  }

  headers[EMBED_TRY_ON_HEADER] = "1";

  const token = nonEmpty(input.sessionAccessToken);

  if (token && isSessionAccessTokenShape(token)) {
    headers[SESSION_ACCESS_HEADER] = token;
  }

  return headers;
}

/** Headers for a follow-up session call. Empty when the page is using the cookie. */
export function buildSessionAuthHeaders(sessionAccessToken: string | null): Record<string, string> {
  const token = nonEmpty(sessionAccessToken);

  if (!token || !isSessionAccessTokenShape(token)) {
    return {};
  }

  return { [SESSION_ACCESS_HEADER]: token };
}

export function readEmbedRevealedToken(payload: { sessionAccessToken?: unknown } | null): string | null {
  const value = payload?.sessionAccessToken;

  if (typeof value !== "string" || !isSessionAccessTokenShape(value)) {
    return null;
  }

  return value;
}

/** One new session id when the embed cannot replay an existing create. */
export function shouldRetryEmbedSessionCreate(status: number): boolean {
  return status === 409;
}
