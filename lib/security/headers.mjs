/**
 * Centralized browser security headers and the Report-Only Content Security Policy.
 *
 * Plain ESM so `next.config.mjs` can import it directly while unit tests exercise the same
 * builders. Nothing here may read a server-only secret: every value emitted lands in a
 * response header that any client can read.
 *
 * Phase 8C.3C deliberately omits several headers; see the "deferred" notes below.
 */

const HSTS_VALUE = "max-age=31536000; includeSubDomains";
const PERMISSIONS_POLICY_VALUE = "camera=(self), geolocation=(), microphone=()";

/**
 * Reduces a configured public URL to a bare origin usable as a CSP source.
 *
 * Paths, query strings and credentials are discarded so a configured URL can never carry a
 * key, token or DSN fragment into a response header. Absent or unparseable configuration
 * yields undefined rather than the string "undefined", which would otherwise become a
 * bogus CSP source.
 *
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
export function toCspOrigin(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  let parsed;

  try {
    parsed = new URL(value.trim());
  } catch {
    return undefined;
  }

  // Only network-addressable schemes belong in a source list. Opaque origins serialize to
  // the literal "null", which must never be emitted.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return undefined;
  }

  return parsed.origin === "null" ? undefined : parsed.origin;
}

/**
 * @param {(string | undefined)[]} sources
 * @returns {string[]}
 */
function sourceList(sources) {
  return [...new Set(sources.filter((source) => typeof source === "string" && source !== ""))];
}

/**
 * Builds the Report-Only CSP.
 *
 * Deliberate omissions:
 * - `frame-ancestors`: path-specific framing lives in `lib/embed/framing.ts` and is applied
 *   from `proxy.ts`. A blanket rule in this global Report-Only policy would either block the
 *   merchant embed or frame the dashboard.
 * - OpenAI and Sentry: both are server-side only, so the browser never contacts them.
 * - Google Fonts: `next/font/google` self-hosts at build time, so fonts load from 'self'.
 * - Supabase websockets: no realtime channel is opened anywhere in the client source.
 *
 * @param {{ isProduction: boolean, supabaseUrl?: string, posthogHost?: string }} options
 * @returns {string}
 */
export function buildContentSecurityPolicy({ isProduction, supabaseUrl, posthogHost }) {
  const supabaseOrigin = toCspOrigin(supabaseUrl);
  const posthogOrigin = toCspOrigin(posthogHost);

  /** @type {(string | undefined)[]} */
  const scriptSrc = ["'self'", "'unsafe-inline'"];

  if (!isProduction) {
    // Next.js dev tooling (webpack HMR, React Refresh) evaluates generated code. Production
    // App Router output does not, so 'unsafe-eval' never reaches the production policy.
    scriptSrc.push("'unsafe-eval'");
  }

  /** @type {(string | undefined)[]} */
  const connectSrc = ["'self'", supabaseOrigin, posthogOrigin];

  if (!isProduction) {
    // Local HMR websocket. CSP3 'self' should cover a same-origin ws:// upgrade, but browser
    // behavior has varied, and this stays out of the production policy either way.
    connectSrc.push("ws://localhost:*", "ws://127.0.0.1:*");
  }

  const directives = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "form-action": ["'self'"],
    // Inline scripts are required until App Router bootstrap payloads are nonce-tagged via
    // middleware, which is an enforcement-phase change rather than an observation one.
    "script-src": scriptSrc,
    // Tailwind and Next.js inject inline style attributes.
    "style-src": ["'self'", "'unsafe-inline'"],
    // data: for the demo base64 result, blob: for uploader previews.
    "img-src": ["'self'", "data:", "blob:", supabaseOrigin],
    "font-src": ["'self'", "data:"],
    "connect-src": connectSrc,
    // blob: keeps Blob-backed workers available to client libraries.
    "worker-src": ["'self'", "blob:"],
  };

  return Object.entries(directives)
    .map(([directive, sources]) => `${directive} ${sourceList(sources).join(" ")}`)
    .join("; ");
}

/**
 * Builds the full header set applied to every response.
 *
 * Deferred in Phase 8C.3C:
 * - `Content-Security-Policy` (enforcing): Report-Only first, so real violations are observed
 *   before anything can break.
 * - `X-Frame-Options` and `frame-ancestors`: applied per path from `lib/embed/framing.ts`,
 *   not from this global set. See the merchant-embedding note above.
 * - COOP, CORP and COEP: evaluated together with the embedding and external-resource model.
 * - HSTS `preload`: not requested in this phase.
 *
 * @param {{ isProduction: boolean, supabaseUrl?: string, posthogHost?: string }} options
 * @returns {{ key: string, value: string }[]}
 */
export function buildSecurityHeaders({ isProduction, supabaseUrl, posthogHost }) {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY_VALUE },
    {
      key: "Content-Security-Policy-Report-Only",
      value: buildContentSecurityPolicy({ isProduction, supabaseUrl, posthogHost }),
    },
  ];

  if (isProduction) {
    // Meaningless and obstructive over plain-http local development.
    headers.push({ key: "Strict-Transport-Security", value: HSTS_VALUE });
  }

  return headers;
}

/**
 * Reads only public configuration. Server-only variables are never consulted.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ key: string, value: string }[]}
 */
export function securityHeadersFromEnv(env = process.env) {
  return buildSecurityHeaders({
    isProduction: env.NODE_ENV === "production",
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    posthogHost: env.NEXT_PUBLIC_POSTHOG_HOST,
  });
}
