import { createHash } from "node:crypto";

export function hashLeadRateLimitIp(ip: string, hashSecret: string): string {
  return createHash("sha256").update(`${hashSecret}:${ip}`).digest("hex");
}
