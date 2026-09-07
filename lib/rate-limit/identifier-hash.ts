import { createHmac } from "node:crypto";

/**
 * Deterministic, namespaced HMAC for rate-limit identifiers that must never be stored as
 * raw values (for example a platform admin's Supabase user id).
 *
 * Deliberately separate from `hashLeadRateLimitIp`, which uses a salted SHA-256 over
 * `secret:value`. Re-basing that helper on HMAC would rotate every live lead rate-limit
 * key mid-window, so the existing lead construction is left untouched and this generic
 * helper is used for new identifiers only.
 *
 * The namespace is part of the HMAC message so the same input hashed for two different
 * limiters cannot be correlated across namespaces.
 */
export function hashRateLimitIdentifier(
  namespace: string,
  value: string,
  hashSecret: string,
): string {
  return createHmac("sha256", hashSecret).update(`${namespace}:${value}`).digest("hex");
}
