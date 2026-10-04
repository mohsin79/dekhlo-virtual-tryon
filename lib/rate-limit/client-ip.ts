import { isIP } from "node:net";

/**
 * Trusted client-address source for IP-scoped rate limiting.
 *
 * Hosting coupling — review this module if the topology changes:
 * - Dekhlo's first deployment target is a Render Web Service.
 * - Render fronts every public web service with Cloudflare, which sets `CF-Connecting-IP`
 *   to exactly one address and overwrites any caller-supplied value.
 * - `CF-Connecting-IP` is therefore the trusted client address on this specific host.
 * - Vercel does not send `CF-Connecting-IP`. It sets `x-vercel-forwarded-for` to the
 *   client address calculated by its proxy and overwrites a caller-supplied value of
 *   that same header. A bare Vercel request therefore carries only that header.
 * - Production trusts exactly one platform header: a single valid `x-vercel-forwarded-for`
 *   or a single valid `CF-Connecting-IP`. If both parse as valid addresses the request
 *   is unavailable. Each platform overwrites only its own header, so a second valid
 *   value was supplied by the caller and must not choose the limiter bucket.
 * - `X-Forwarded-For` is deliberately not trusted: Cloudflare documents that it *appends*
 *   to an existing `X-Forwarded-For` chain rather than replacing it, so a caller can
 *   prepend an arbitrary value and rotate IP-scoped buckets at will. Neither the first nor
 *   the last entry is trustworthy, and the number of proxy hops Render adds is not
 *   documented, so hop counting is not a safe alternative either. `X-Real-IP` is the
 *   same class of generic header and stays untrusted in production on every host.
 * - This is not a general claim that `CF-Connecting-IP` is safe behind any proxy. It is
 *   only trustworthy where Cloudflare is guaranteed to terminate every inbound request.
 *   Moving off Render, or Render moving off Cloudflare, invalidates this assumption and
 *   MUST force a review before IP-scoped limits are relied on again. The same review
 *   applies if Vercel stops overwriting `x-vercel-forwarded-for` with one client address.
 */
const CLOUDFLARE_CLIENT_IP_HEADER = "cf-connecting-ip";
const VERCEL_CLIENT_IP_HEADER = "x-vercel-forwarded-for";

/**
 * Either a syntactically valid single client address, or an explicit statement that no
 * trustworthy address is available.
 *
 * Unavailability is a distinct state rather than a placeholder address: callers must map it
 * to an "unavailable" rate-limit verdict (503), never to a shared bucket that every
 * unattributable request would share.
 */
export type TrustedClientIp = { ok: true; ip: string } | { ok: false };

const TRUSTED_CLIENT_IP_UNAVAILABLE: TrustedClientIp = { ok: false };

/**
 * Accepts a header value only if it is one syntactically valid IPv4 or IPv6 literal.
 *
 * `node:net` `isIP` returns 0 for anything else, which covers blank values, hostnames,
 * comma-separated lists and malformed literals without a new parsing dependency.
 */
export function parseTrustedClientIp(value: string | null | undefined): TrustedClientIp {
  if (typeof value !== "string") {
    return TRUSTED_CLIENT_IP_UNAVAILABLE;
  }

  const candidate = value.trim();

  if (isIP(candidate) === 0) {
    return TRUSTED_CLIENT_IP_UNAVAILABLE;
  }

  return { ok: true, ip: candidate };
}

/**
 * Resolves the client address used to scope IP rate limits.
 *
 * Production accepts one platform header, `x-vercel-forwarded-for` or `CF-Connecting-IP`.
 * An absent or malformed value, or both headers valid at once, is unavailable so the
 * caller fails closed. Outside production, when neither platform header is valid, the
 * historical `X-Forwarded-For` / `X-Real-IP` fallback is preserved so local development
 * does not require Cloudflare or Vercel; production never enters that path.
 */
export function resolveTrustedClientIp(request: Request): TrustedClientIp {
  const cloudflare = parseTrustedClientIp(request.headers.get(CLOUDFLARE_CLIENT_IP_HEADER));
  const vercel = parseTrustedClientIp(request.headers.get(VERCEL_CLIENT_IP_HEADER));

  if (vercel.ok && cloudflare.ok) {
    return TRUSTED_CLIENT_IP_UNAVAILABLE;
  }

  if (vercel.ok) {
    return vercel;
  }

  if (cloudflare.ok) {
    return cloudflare;
  }

  if (process.env.NODE_ENV === "production") {
    return TRUSTED_CLIENT_IP_UNAVAILABLE;
  }

  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();

    if (first) {
      return { ok: true, ip: first };
    }
  }

  const real = request.headers.get("x-real-ip")?.trim();

  return { ok: true, ip: real || "unknown" };
}
