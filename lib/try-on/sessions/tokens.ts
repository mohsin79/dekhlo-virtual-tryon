import "server-only";

import { cookies } from "next/headers";
import {
  selectPresentedSessionToken,
  SESSION_ACCESS_HEADER,
} from "@/lib/embed/session-presentation";
import { SESSION_ACCESS_COOKIE_PREFIX } from "@/lib/try-on/sessions/constants";
import {
  generateDemoSessionId,
  generateSessionAccessToken,
  hashSessionAccessToken,
  tokensMatch,
} from "@/lib/try-on/sessions/token-crypto";

export {
  generateDemoSessionId,
  generateSessionAccessToken,
  hashSessionAccessToken,
  tokensMatch,
};
export type { SessionAccessToken } from "@/lib/try-on/sessions/token-crypto";

export const DEMO_ACCESS_COOKIE = "dekhlo_demo_session";

export function sessionAccessCookieName(sessionId: string): string {
  return `${SESSION_ACCESS_COOKIE_PREFIX}${sessionId}`;
}

export async function setSessionAccessCookie(
  sessionId: string,
  token: string,
  expiresAt: Date,
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(sessionAccessCookieName(sessionId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function readSessionAccessToken(sessionId: string): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(sessionAccessCookieName(sessionId))?.value ?? null;
}

/**
 * Cookie first, then the embed header. The cookie attributes are unchanged:
 * httpOnly, Secure in production, SameSite=Lax. The header exists so a
 * cross-site iframe can present the same secret when the browser will not
 * store or send that cookie.
 */
export async function readPresentedSessionAccessToken(
  sessionId: string,
  request?: Request,
): Promise<string | null> {
  const cookieToken = await readSessionAccessToken(sessionId);
  const headerToken = request?.headers.get(SESSION_ACCESS_HEADER) ?? null;
  return selectPresentedSessionToken({ cookieToken, headerToken });
}
