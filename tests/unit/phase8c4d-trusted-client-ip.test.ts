import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseTrustedClientIp, resolveTrustedClientIp } from "@/lib/rate-limit/client-ip";

const CLIENT_IP_MODULE = "lib/rate-limit/client-ip.ts";
const RATE_LIMIT_MODULE = "lib/rate-limit/index.ts";
const LEAD_HANDLER = "lib/leads/handle-lead-capture.ts";
const SESSION_CREATE_ROUTE = "app/api/try-on/sessions/route.ts";
const DEMO_HANDLER = "lib/try-on/demo-handler.ts";
const PLATFORM_HANDLER = "lib/platform/handle-credit-mutation.ts";

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://dekhlo.example/api/demo/try-on", { method: "POST", headers });
}

/** NODE_ENV is read at call time, so the boundary can be exercised directly. */
function withNodeEnv<T>(value: string | undefined, fn: () => T): T {
  const mutable = process.env as Record<string, string | undefined>;
  const previous = mutable.NODE_ENV;

  try {
    mutable.NODE_ENV = value;
    return fn();
  } finally {
    mutable.NODE_ENV = previous;
  }
}

function resolveInProduction(headers: Record<string, string>) {
  return withNodeEnv("production", () => resolveTrustedClientIp(requestWith(headers)));
}

function resolveInDevelopment(headers: Record<string, string>) {
  return withNodeEnv("development", () => resolveTrustedClientIp(requestWith(headers)));
}

describe("trusted client IP validation", () => {
  it("accepts a single valid IPv4 literal", () => {
    const result = parseTrustedClientIp("198.51.100.10");

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.ip, "198.51.100.10");
  });

  it("accepts valid IPv6 literals", () => {
    for (const address of ["2001:db8::1", "::1", "fe80::1ff:fe23:4567:890a", "2001:db8:0:0:0:0:0:1"]) {
      const result = parseTrustedClientIp(address);

      assert.equal(result.ok, true, `${address} must be accepted`);
      assert.equal(result.ok && result.ip, address);
    }
  });

  it("trims ordinary surrounding whitespace before validating", () => {
    for (const raw of ["  198.51.100.10  ", "\t2001:db8::1", "198.51.100.10\n"]) {
      const result = parseTrustedClientIp(raw);

      assert.equal(result.ok, true, `${JSON.stringify(raw)} must be accepted`);
      assert.equal(result.ok && result.ip, raw.trim());
    }
  });

  it("rejects a missing or blank value as unavailable", () => {
    for (const raw of [null, undefined, "", "   ", "\t\n"]) {
      assert.equal(
        parseTrustedClientIp(raw).ok,
        false,
        `${JSON.stringify(raw)} must be unavailable`,
      );
    }
  });

  it("rejects malformed addresses, hostnames and decorated literals", () => {
    const malformed = [
      "attacker.example",
      "localhost",
      "not-an-ip",
      "999.999.999.999",
      "256.1.1.1",
      "1.2.3",
      "1.2.3.4.5",
      "1.2.3.4:8080",
      "1.2.3.4/24",
      "[2001:db8::1]",
      "2001:db8::1::2",
      "0x7f000001",
      "-1.2.3.4",
    ];

    for (const raw of malformed) {
      assert.equal(parseTrustedClientIp(raw).ok, false, `${raw} must be unavailable`);
    }
  });

  it("rejects comma-separated or multi-valued headers as unavailable", () => {
    for (const raw of [
      "1.2.3.4, 5.6.7.8",
      "1.2.3.4,5.6.7.8",
      "198.51.100.10, 203.0.113.7, 10.0.0.1",
      "2001:db8::1, 2001:db8::2",
      "1.2.3.4 5.6.7.8",
    ]) {
      assert.equal(parseTrustedClientIp(raw).ok, false, `${raw} must be unavailable`);
    }
  });

  it("uses node:net rather than a new parsing dependency", () => {
    const source = readFileSync(CLIENT_IP_MODULE, "utf8");
    const dependencies = JSON.parse(readFileSync("package.json", "utf8")).dependencies as Record<
      string,
      string
    >;

    assert.match(source, /import \{ isIP \} from "node:net";/);

    for (const name of Object.keys(dependencies)) {
      assert.doesNotMatch(name, /^(ip|ipaddr|ip-address|ipaddr\.js|is-ip|cidr|netmask)/);
    }
  });
});

describe("production trusted client IP resolution", () => {
  it("uses a valid CF-Connecting-IP header", () => {
    const result = resolveInProduction({ "cf-connecting-ip": "198.51.100.10" });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.ip, "198.51.100.10");
  });

  it("accepts IPv6 from CF-Connecting-IP", () => {
    const result = resolveInProduction({ "cf-connecting-ip": "2001:db8::1" });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.ip, "2001:db8::1");
  });

  it("trims whitespace around the production header value", () => {
    const result = resolveInProduction({ "cf-connecting-ip": " 198.51.100.10 " });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.ip, "198.51.100.10");
  });

  it("reports a missing CF-Connecting-IP as unavailable", () => {
    assert.equal(resolveInProduction({}).ok, false);
  });

  it("reports a blank CF-Connecting-IP as unavailable", () => {
    assert.equal(resolveInProduction({ "cf-connecting-ip": "   " }).ok, false);
  });

  it("reports a malformed CF-Connecting-IP as unavailable", () => {
    assert.equal(resolveInProduction({ "cf-connecting-ip": "attacker.example" }).ok, false);
  });

  it("reports a comma-separated CF-Connecting-IP as unavailable", () => {
    assert.equal(resolveInProduction({ "cf-connecting-ip": "1.2.3.4, 5.6.7.8" }).ok, false);
  });
});

describe("production never trusts caller-supplied forwarding headers", () => {
  it("prefers CF-Connecting-IP over an attacker-prepended X-Forwarded-For chain", () => {
    // Cloudflare appends to an existing chain, so the first XFF entry is caller-controlled.
    const result = resolveInProduction({
      "cf-connecting-ip": "198.51.100.10",
      "x-forwarded-for": "1.2.3.4, 5.6.7.8",
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.ip, "198.51.100.10");
    assert.notEqual(result.ok && result.ip, "1.2.3.4");
  });

  it("prefers CF-Connecting-IP over an arbitrary attacker-controlled X-Forwarded-For value", () => {
    const result = resolveInProduction({
      "cf-connecting-ip": "198.51.100.10",
      "x-forwarded-for": "attacker-controlled-value",
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.ip, "198.51.100.10");
  });

  it("ignores X-Real-IP, True-Client-IP and Forwarded when CF-Connecting-IP is present", () => {
    const result = resolveInProduction({
      "cf-connecting-ip": "198.51.100.10",
      "x-real-ip": "1.2.3.4",
      "true-client-ip": "5.6.7.8",
      forwarded: "for=9.9.9.9",
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.ip, "198.51.100.10");
  });

  it("treats X-Forwarded-For alone as unavailable, never as a client address", () => {
    const result = resolveInProduction({ "x-forwarded-for": "1.2.3.4" });

    assert.equal(result.ok, false);
    assert.equal("ip" in result, false);
  });

  it("treats a full X-Forwarded-For chain alone as unavailable", () => {
    assert.equal(resolveInProduction({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.9.9.9" }).ok, false);
  });

  it("treats X-Real-IP alone as unavailable", () => {
    assert.equal(resolveInProduction({ "x-real-ip": "203.0.113.5" }).ok, false);
  });

  it("treats True-Client-IP alone as unavailable", () => {
    assert.equal(resolveInProduction({ "true-client-ip": "203.0.113.5" }).ok, false);
  });

  it("treats Forwarded alone as unavailable", () => {
    assert.equal(resolveInProduction({ forwarded: "for=203.0.113.5;proto=https" }).ok, false);
  });

  it("never produces a shared placeholder address in production", () => {
    const cases: Record<string, string>[] = [
      {},
      { "x-forwarded-for": "1.2.3.4" },
      { "x-real-ip": "1.2.3.4" },
      { "cf-connecting-ip": "bogus" },
    ];

    for (const headers of cases) {
      const result = resolveInProduction(headers);

      assert.equal(result.ok, false);
      assert.notEqual((result as { ip?: string }).ip, "unknown");
    }
  });

  it("cannot be rotated by varying spoofed forwarding headers", () => {
    // The pre-8C.4D helper returned a distinct bucket per spoofed value. Every one of these
    // must now be a single unavailable verdict instead.
    const outcomes = new Set(
      Array.from({ length: 25 }, (_, index) =>
        JSON.stringify(resolveInProduction({ "x-forwarded-for": `203.0.113.${index + 1}` })),
      ),
    );

    assert.equal(outcomes.size, 1);
    assert.equal([...outcomes][0], JSON.stringify({ ok: false }));
  });
});

describe("development trusted client IP fallback", () => {
  it("preserves the first X-Forwarded-For entry outside production", () => {
    const result = resolveInDevelopment({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.ip, "1.2.3.4");
  });

  it("preserves the X-Real-IP fallback outside production", () => {
    const result = resolveInDevelopment({ "x-real-ip": "203.0.113.5" });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.ip, "203.0.113.5");
  });

  it("does not require a CF-Connecting-IP header for local development", () => {
    const result = resolveInDevelopment({});

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.ip, "unknown");
  });

  it("still prefers CF-Connecting-IP when it is present outside production", () => {
    const result = resolveInDevelopment({
      "cf-connecting-ip": "198.51.100.10",
      "x-forwarded-for": "1.2.3.4",
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.ip, "198.51.100.10");
  });

  it("treats a non-production NODE_ENV such as test the same as development", () => {
    const result = withNodeEnv("test", () =>
      resolveTrustedClientIp(requestWith({ "x-forwarded-for": "1.2.3.4" })),
    );

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.ip, "1.2.3.4");
  });

  it("switches to fail-closed behavior solely on the NODE_ENV boundary", () => {
    const headers = { "x-forwarded-for": "1.2.3.4" };

    assert.equal(resolveInDevelopment(headers).ok, true);
    assert.equal(resolveInProduction(headers).ok, false);
  });

  it("gates the fallback behind an explicit production check", () => {
    const source = readFileSync(CLIENT_IP_MODULE, "utf8");

    assert.match(source, /process\.env\.NODE_ENV === "production"/);
    assert.match(source, /if \(cloudflare\.ok \|\| process\.env\.NODE_ENV === "production"\) \{/);
  });
});

describe("trusted client IP limiter integration", () => {
  it("routes every IP-scoped limiter through the trusted resolver", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");

    for (const limiter of ["limitLeadCaptureByIp", "limitSessionCreation", "limitDemoByIp"]) {
      const fn = source.slice(
        source.indexOf(`export async function ${limiter}`),
        source.indexOf("\n}", source.indexOf(`export async function ${limiter}`)),
      );

      assert.match(fn, /request: Request/, `${limiter} must receive the request`);
      assert.match(fn, /resolveTrustedClientIp\(request\)/, `${limiter} must resolve trust`);
      assert.match(
        fn,
        /if \(!client\.ok\) \{\s*\n\s*return RATE_LIMIT_UNAVAILABLE;/,
        `${limiter} must fail closed`,
      );
    }
  });

  it("passes only the trusted address to the limiter store", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");

    assert.match(source, /sessionCreateLimiter\(client\.ip\)/);
    assert.match(source, /demoIpLimiter\(client\.ip\)/);
    assert.match(source, /hashLeadRateLimitIp\(client\.ip, getRateLimitHashSecret\(\)\)/);
    assert.match(source, /leadIpLimiter\(hashed\)/);
  });

  it("fails closed before the limiter is consulted, not after", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");

    for (const [limiter, call] of [
      ["limitSessionCreation", "sessionCreateLimiter(client.ip)"],
      ["limitDemoByIp", "demoIpLimiter(client.ip)"],
      ["limitLeadCaptureByIp", "leadIpLimiter(hashed)"],
    ]) {
      const start = source.indexOf(`export async function ${limiter}`);
      const fn = source.slice(start, source.indexOf("\n}", start));

      assert.ok(
        fn.indexOf("RATE_LIMIT_UNAVAILABLE") < fn.indexOf(call),
        `${limiter} must return unavailable before calling ${call}`,
      );
    }
  });

  it("classifies an untrusted address as unavailable rather than limited", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");

    // 429 must stay reserved for an evaluated limit breach; a missing trusted address is
    // hosting/infrastructure unavailability.
    assert.doesNotMatch(source, /if \(!client\.ok\) \{\s*\n\s*return limitedDecision/);
    assert.doesNotMatch(source, /rateLimitedResponse/);
  });

  it("reuses the Phase 8C.3B three-valued decision model", () => {
    const decision = readFileSync("lib/rate-limit/decision.ts", "utf8");
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");

    assert.match(decision, /export type RateLimitOutcome = "allowed" \| "limited" \| "unavailable";/);
    assert.match(source, /RATE_LIMIT_UNAVAILABLE/);
    assert.doesNotMatch(source, /TrustedIpError|ClientIpFailure|new Error\("cf-/i);
  });

  it("leaves session, cookie, global and platform identifiers untouched", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");

    assert.match(source, /limitLeadCaptureBySession\(sessionId: string\)/);
    assert.match(source, /leadSessionLimiter\(sessionId\)/);
    assert.match(source, /leadGlobalLimiter\("global"\)/);
    assert.match(source, /limitDemoByCookie\(cookieId: string\)/);
    assert.match(source, /demoCookieLimiter\(cookieId\)/);
    assert.match(source, /demoGlobalLimiter\("global"\)/);
    assert.match(source, /platformCreditActorLimiter\(hashed\)/);
  });

  it("keeps every limiter threshold, window and namespace unchanged", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");

    for (const [max, window, prefix] of [
      [5, "1 h", "lead-session"],
      [30, "1 h", "lead-ip"],
      [200, "1 h", "lead-global"],
      [20, "1 h", "tryon-session-create"],
      [30, "1 h", "demo-ip"],
      [5, "1 d", "demo-cookie"],
      ["cap", "1 d", "demo-global"],
    ] as [number | string, string, string][]) {
      assert.ok(
        source.includes(`createUpstashLimiter(${max}, "${window}", "${prefix}")`),
        `${prefix} must remain ${max} per ${window}`,
      );
    }

    assert.match(source, /export const PLATFORM_CREDIT_MUTATION_LIMIT = 30;/);
    assert.match(source, /export const PLATFORM_CREDIT_MUTATION_WINDOW = "1 m"/);
  });

  it("removes the unsafe first-X-Forwarded-For helper entirely", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");

    assert.doesNotMatch(source, /getClientIp/);
    assert.doesNotMatch(source, /x-forwarded-for/i);
    assert.doesNotMatch(source, /x-real-ip/i);
  });
});

describe("trusted client IP route behavior", () => {
  it("answers an untrusted production address with 503 on session creation", () => {
    const source = readFileSync(SESSION_CREATE_ROUTE, "utf8");

    assert.match(source, /limitSessionCreation\(request\)/);
    assert.doesNotMatch(source, /getClientIp/);
    assert.match(
      source,
      /if \(rate\.outcome === "unavailable"\) \{\s*\n\s*return serviceUnavailableResponse\(\);/,
    );
  });

  it("creates no session row and reserves no credit for an untrusted address", () => {
    const source = readFileSync(SESSION_CREATE_ROUTE, "utf8");

    assert.ok(
      source.indexOf("serviceUnavailableResponse()") < source.indexOf("createTryOnSession("),
      "the 503 must return before any session side effect",
    );
  });

  it("answers an untrusted production address with 503 on lead capture", () => {
    const source = readFileSync(LEAD_HANDLER, "utf8");

    assert.match(source, /limitLeadCaptureByIp\(request\)/);
    assert.match(
      source,
      /if \(rateLimit === "unavailable"\) \{\s*\n\s*return serviceUnavailableResponse\(\);/,
    );
  });

  it("runs no lead RPC for an untrusted address", () => {
    const source = readFileSync(LEAD_HANDLER, "utf8");

    assert.ok(
      source.indexOf("serviceUnavailableResponse()") <
        source.indexOf('supabase.rpc("create_try_on_lead"'),
      "the 503 must return before the lead RPC",
    );
  });

  it("answers an untrusted production address with 503 on demo try-on", () => {
    const source = readFileSync(DEMO_HANDLER, "utf8");

    assert.match(source, /limitDemoByIp\(request\)/);
    assert.doesNotMatch(source, /getClientIp/);
    assert.match(
      source,
      /if \(networkRateLimit === "unavailable"\) \{\s*\n\s*return serviceUnavailableResponse\(\);/,
    );
  });

  it("runs no OpenAI generation for an untrusted address", () => {
    const source = readFileSync(DEMO_HANDLER, "utf8");

    assert.ok(
      source.indexOf("serviceUnavailableResponse()") < source.indexOf("generateTryOnImage("),
      "the 503 must return before any generation",
    );
    assert.ok(
      source.indexOf("limitDemoByIp(request)") < source.indexOf("process.env.OPENAI_API_KEY"),
      "the IP verdict must precede the OpenAI key check",
    );
  });

  it("keeps 429 reserved for an evaluated limit breach on every route", () => {
    for (const file of [LEAD_HANDLER, SESSION_CREATE_ROUTE, DEMO_HANDLER, PLATFORM_HANDLER]) {
      const source = readFileSync(file, "utf8");

      assert.match(source, /rateLimitedResponse\(\)/, `${file} must still answer 429`);
      assert.match(source, /"limited"/, `${file} must distinguish limited from unavailable`);
    }
  });

  it("leaves the platform credit actor limiter unchanged", () => {
    const source = readFileSync(PLATFORM_HANDLER, "utf8");

    assert.match(source, /limitPlatformCreditMutation\(user\.id\)/);
    assert.doesNotMatch(source, /resolveTrustedClientIp|cf-connecting-ip|getClientIp/i);
  });
});

describe("trusted client IP privacy", () => {
  it("adds no logging of addresses or forwarding headers", () => {
    for (const file of [CLIENT_IP_MODULE, RATE_LIMIT_MODULE]) {
      const source = readFileSync(file, "utf8");

      assert.doesNotMatch(source, /console\.(log|error|info|debug|trace)/, `${file} must not log`);
      assert.doesNotMatch(
        source,
        /console\.warn\([^)]*(ip|identifier|actor|hashed|header)/i,
        `${file} must not warn with an address`,
      );
    }
  });

  it("sends no address or header value to Sentry or PostHog", () => {
    for (const file of [CLIENT_IP_MODULE, RATE_LIMIT_MODULE]) {
      const source = readFileSync(file, "utf8");

      assert.doesNotMatch(
        source,
        /captureUnexpectedError|captureOperationalMessage|Sentry|posthog/i,
        `${file} must not report to observability`,
      );
    }
  });

  it("keeps the existing lead IP hash boundary so no raw address reaches the store", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");
    const start = source.indexOf("export async function limitLeadCaptureByIp");
    const fn = source.slice(start, source.indexOf("\n}", start));

    assert.ok(
      fn.indexOf("hashLeadRateLimitIp(") < fn.indexOf("leadIpLimiter("),
      "the limiter must receive the hash, not the address",
    );
    assert.doesNotMatch(fn, /leadIpLimiter\(client\.ip\)/);
  });

  it("returns no diagnostic reason alongside an unavailable verdict", () => {
    const source = readFileSync(CLIENT_IP_MODULE, "utf8");

    // A reason string would risk being surfaced or logged; unavailability is opaque.
    assert.match(source, /export type TrustedClientIp = \{ ok: true; ip: string \} \| \{ ok: false \};/);
    assert.doesNotMatch(source, /reason|message|detail/);
  });

  it("exposes no hosting, header or address detail to clients", () => {
    const forbidden = /cloudflare|cf-connecting|render|proxy|x-forwarded|x-real-ip|\bip\b|header/i;

    for (const file of [LEAD_HANDLER, SESSION_CREATE_ROUTE, DEMO_HANDLER, PLATFORM_HANDLER]) {
      const source = readFileSync(file, "utf8");

      for (const message of [...source.matchAll(/genericErrorResponse\("([^"]+)"/g)].map(
        (match) => match[1],
      )) {
        assert.doesNotMatch(message, forbidden, `${file} leaks detail: ${message}`);
      }
    }

    const helper = readFileSync("lib/api/security.ts", "utf8");
    const unavailable = helper.slice(helper.indexOf("export function serviceUnavailableResponse"));

    assert.match(unavailable, /Service temporarily unavailable\./);
    assert.match(unavailable, /status: 503/);
    assert.doesNotMatch(unavailable.split("\n}")[0], forbidden);
  });
});

describe("trusted client IP hosting coupling documentation", () => {
  it("records the Render and Cloudflare assumption at the resolver", () => {
    const source = readFileSync(CLIENT_IP_MODULE, "utf8");
    const doc = source.slice(0, source.indexOf("const CLOUDFLARE_CLIENT_IP_HEADER"));

    assert.match(doc, /Render Web Service/);
    assert.match(doc, /Cloudflare/);
    assert.match(doc, /CF-Connecting-IP/);
    assert.match(doc, /append/i);
    assert.match(doc, /MUST force a review/);
  });

  it("does not claim CF-Connecting-IP is safe behind every proxy", () => {
    const source = readFileSync(CLIENT_IP_MODULE, "utf8");
    const doc = source.slice(0, source.indexOf("const CLOUDFLARE_CLIENT_IP_HEADER"));

    assert.match(doc, /not a general claim/i);
    assert.match(doc, /only trustworthy where Cloudflare is guaranteed/i);
  });

  it("explains why neither X-Forwarded-For end nor hop counting is used", () => {
    const source = readFileSync(CLIENT_IP_MODULE, "utf8");
    const doc = source.slice(0, source.indexOf("const CLOUDFLARE_CLIENT_IP_HEADER"));

    assert.match(doc, /hop count/i);
    assert.match(doc, /Neither the first nor\s*\n?\s*\*?\s*the last entry/i);
  });
});
