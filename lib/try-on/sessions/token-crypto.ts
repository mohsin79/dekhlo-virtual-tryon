import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type SessionAccessToken = {
  token: string;
  hash: string;
};

export function generateSessionAccessToken(): SessionAccessToken {
  const token = randomBytes(32).toString("base64url");
  const hash = hashSessionAccessToken(token);
  return { token, hash };
}

export function hashSessionAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokensMatch(expectedHash: string, providedToken: string): boolean {
  const providedHash = hashSessionAccessToken(providedToken);
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  const providedBuffer = Buffer.from(providedHash, "hex");

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function generateDemoSessionId(): string {
  return randomBytes(16).toString("hex");
}
