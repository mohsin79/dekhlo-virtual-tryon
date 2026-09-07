import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  allowedDecision,
  classifyUpstashResponse,
  combineRateLimitDecisions,
  limitedDecision,
  RATE_LIMIT_UNAVAILABLE,
} from "@/lib/rate-limit/decision";
import { hashRateLimitIdentifier } from "@/lib/rate-limit/identifier-hash";
import { hashLeadRateLimitIp } from "@/lib/rate-limit/lead-ip-hash";

const RATE_LIMIT_MODULE = "lib/rate-limit/index.ts";
const LEAD_HANDLER = "lib/leads/handle-lead-capture.ts";
const SESSION_CREATE_ROUTE = "app/api/try-on/sessions/route.ts";
const DEMO_HANDLER = "lib/try-on/demo-handler.ts";
const PLATFORM_HANDLER = "lib/platform/handle-credit-mutation.ts";
const UPSTASH_DIST = "node_modules/@upstash/ratelimit/dist/index.mjs";

/** A response shaped like a successful Upstash evaluation. */
function upstashResponse(overrides: Record<string, unknown> = {}) {
  return { success: true, limit: 30, remaining: 29, reset: 0, ...overrides };
}

describe("rate-limit decision model", () => {
  it("classifies an evaluated permitted response as allowed", () => {
    const decision = classifyUpstashResponse(upstashResponse());

    assert.equal(decision.outcome, "allowed");
    assert.equal(decision.limit, 30);
    assert.equal(decision.remaining, 29);
  });

  it("classifies an evaluated denied response as limited", () => {
    const decision = classifyUpstashResponse(upstashResponse({ success: false, remaining: 0 }));

    assert.equal(decision.outcome, "limited");
    assert.equal(decision.remaining, 0);
  });

  it("classifies success:true with reason timeout as unavailable, never allowed", () => {
    const decision = classifyUpstashResponse(
      upstashResponse({ success: true, limit: 0, remaining: 0, reason: "timeout" }),
    );

    assert.equal(decision.outcome, "unavailable");
    assert.notEqual(decision.outcome, "allowed");
  });

  it("reproduces the installed @upstash/ratelimit timeout payload", () => {
    // Tie the classifier to the behavior actually shipped in node_modules rather than to a
    // remembered API: the library resolves the timeout race with success:true.
    const source = readFileSync(UPSTASH_DIST, "utf8");
    const timeoutBlock = source.slice(
      source.indexOf("applyTimeout"),
      source.indexOf('reason: "timeout"') + 20,
    );

    assert.match(timeoutBlock, /success: true/);
    assert.match(timeoutBlock, /reason: "timeout"/);
    assert.match(source, /this\.timeout = config\.timeout \?\? 5e3/);

    const libraryTimeoutResponse = {
      success: true,
      limit: 0,
      remaining: 0,
      reset: 0,
      reason: "timeout",
    };

    assert.equal(classifyUpstashResponse(libraryTimeoutResponse).outcome, "unavailable");
  });

  it("treats cacheBlock and denyList denials as ordinary rate limiting", () => {
    for (const reason of ["cacheBlock", "denyList"]) {
      assert.equal(
        classifyUpstashResponse(upstashResponse({ success: false, reason })).outcome,
        "limited",
        `${reason} is a real denial`,
      );
    }
  });

  it("classifies malformed provider responses as unavailable", () => {
    const malformed: unknown[] = [
      null,
      undefined,
      "ok",
      42,
      true,
      {},
      { limit: 30 },
      { success: "true" },
      { success: 1 },
      { success: null },
    ];

    for (const response of malformed) {
      assert.equal(
        classifyUpstashResponse(response).outcome,
        "unavailable",
        `expected unavailable for ${JSON.stringify(response)}`,
      );
    }
  });

  it("drops non-numeric limit and remaining metadata", () => {
    const decision = classifyUpstashResponse(
      upstashResponse({ limit: "30", remaining: Number.NaN }),
    );

    assert.equal(decision.outcome, "allowed");
    assert.equal(decision.limit, undefined);
    assert.equal(decision.remaining, undefined);
  });

  it("exposes unavailable as a distinct terminal verdict", () => {
    assert.equal(RATE_LIMIT_UNAVAILABLE.outcome, "unavailable");
    assert.equal(RATE_LIMIT_UNAVAILABLE.limit, undefined);
    assert.equal(RATE_LIMIT_UNAVAILABLE.remaining, undefined);
  });
});

describe("rate-limit decision combination", () => {
  it("returns allowed only when every limiter allowed", () => {
    assert.equal(
      combineRateLimitDecisions([allowedDecision(5, 4), allowedDecision(30, 29), allowedDecision()]),
      "allowed",
    );
  });

  it("prefers a definite denial over an unavailable verdict", () => {
    assert.equal(
      combineRateLimitDecisions([limitedDecision(5, 0), RATE_LIMIT_UNAVAILABLE]),
      "limited",
    );
  });

  it("returns unavailable when any limiter could not be evaluated", () => {
    assert.equal(
      combineRateLimitDecisions([allowedDecision(), RATE_LIMIT_UNAVAILABLE, allowedDecision()]),
      "unavailable",
    );
  });

  it("never treats an empty verdict set as allowed", () => {
    assert.equal(combineRateLimitDecisions([]), "unavailable");
  });
});

describe("rate-limit provider configuration", () => {
  it("configures an explicit 2000 ms Upstash timeout below the library default", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");

    assert.match(source, /export const UPSTASH_LIMIT_TIMEOUT_MS = 2000;/);
    assert.match(source, /timeout: UPSTASH_LIMIT_TIMEOUT_MS,/);
    assert.ok(2000 < 5000, "must be tighter than the @upstash/ratelimit default");
  });

  it("routes every provider response through the classifier", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");

    assert.match(source, /classifyUpstashResponse\(await ratelimit\.limit\(identifier\)\)/);
    assert.doesNotMatch(source, /success: result\.success/);
  });

  it("converts initialization and provider failures into unavailable, not exceptions", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");
    const lazy = source.slice(source.indexOf("function createLazyLimiter"));

    assert.match(lazy, /catch \{/);
    assert.match(lazy, /return RATE_LIMIT_UNAVAILABLE;/);
    assert.match(lazy, /limiterPromise = null;/);
  });

  it("keeps the in-memory limiter for local development and throws in production", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");

    assert.match(
      source,
      /if \(process\.env\.NODE_ENV === "production"\) \{\s*\n\s*throw new Error\("Rate limit infrastructure is unavailable\."\);/,
    );
    assert.match(source, /return createMemoryLimiter\(max, windowToMs\(window\), prefix\);/);
  });

  it("preserves every existing limiter threshold, window and namespace", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");
    const expected: [number | string, string, string][] = [
      [5, "1 h", "lead-session"],
      [30, "1 h", "lead-ip"],
      [200, "1 h", "lead-global"],
      [20, "1 h", "tryon-session-create"],
      [30, "1 h", "demo-ip"],
      [5, "1 d", "demo-cookie"],
      ["cap", "1 d", "demo-global"],
    ];

    for (const [max, window, prefix] of expected) {
      assert.ok(
        source.includes(`createUpstashLimiter(${max}, "${window}", "${prefix}")`),
        `${prefix} must remain ${max} per ${window}`,
      );
    }
  });

  it("keeps limiter namespaces distinct", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");
    const prefixes = [...source.matchAll(/createUpstashLimiter\([^,]+, "[^"]+", "([^"]+)"\)/g)].map(
      (match) => match[1],
    );

    prefixes.push("platform-credit-actor");

    assert.equal(new Set(prefixes).size, prefixes.length, "namespaces must not collide");
  });

  it("does not log identifiers or report rate-limit verdicts to Sentry or PostHog", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");

    assert.doesNotMatch(source, /console\.(log|error|info)/);
    assert.doesNotMatch(source, /captureUnexpectedError|captureOperationalMessage|posthog/i);
    assert.doesNotMatch(source, /console\.warn\([^)]*(ip|identifier|actor|hashed)/i);
  });

  it("documents the trusted-proxy assumption for getClientIp", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");
    const doc = source.slice(
      source.indexOf("Trusted-proxy assumption"),
      source.indexOf("export function getClientIp"),
    );

    assert.match(doc, /overwrite or sanitize/i);
    assert.match(doc, /Not all\s*\n?\s*\*?\s*proxies do/i);
    assert.match(doc, /must be reviewed/i);
    // Header selection itself is unchanged in this slice.
    assert.match(source, /request\.headers\.get\("x-forwarded-for"\)/);
    assert.match(source, /request\.headers\.get\("x-real-ip"\)/);
  });
});

describe("rate-limit identifier hashing", () => {
  it("produces a deterministic namespaced digest", () => {
    const first = hashRateLimitIdentifier("platform-credit-actor", "actor-uuid", "secret");
    const second = hashRateLimitIdentifier("platform-credit-actor", "actor-uuid", "secret");

    assert.equal(first, second);
    assert.match(first, /^[0-9a-f]{64}$/);
  });

  it("never embeds the raw value or the secret", () => {
    const actorId = "550e8400-e29b-41d4-a716-446655440000";
    const hashed = hashRateLimitIdentifier("platform-credit-actor", actorId, "unit-secret");

    assert.equal(hashed.includes(actorId), false);
    assert.equal(hashed.includes("unit-secret"), false);
  });

  it("separates identical values across namespaces", () => {
    assert.notEqual(
      hashRateLimitIdentifier("platform-credit-actor", "same", "secret"),
      hashRateLimitIdentifier("other-namespace", "same", "secret"),
    );
  });

  it("changes with the secret", () => {
    assert.notEqual(
      hashRateLimitIdentifier("ns", "value", "secret-a"),
      hashRateLimitIdentifier("ns", "value", "secret-b"),
    );
  });

  it("leaves the existing lead IP hash construction unchanged", () => {
    // Re-basing the lead helper on HMAC would rotate every live lead rate-limit key.
    const expected = createHash("sha256").update("secret:203.0.113.10").digest("hex");

    assert.equal(hashLeadRateLimitIp("203.0.113.10", "secret"), expected);
    assert.notEqual(
      hashLeadRateLimitIp("203.0.113.10", "secret"),
      hashRateLimitIdentifier("lead-ip", "203.0.113.10", "secret"),
    );
  });

  it("hashes the platform actor id before it reaches the limiter", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");
    const fn = source.slice(source.indexOf("export async function limitPlatformCreditMutation"));
    const hashIndex = fn.indexOf("hashRateLimitIdentifier(");
    const limiterIndex = fn.indexOf("platformCreditActorLimiter(");

    assert.ok(hashIndex > -1, "actor id must be hashed");
    assert.ok(limiterIndex > hashIndex, "the limiter must receive the hash, not the raw id");
    assert.match(fn, /platformCreditActorLimiter\(hashed\)/);
    assert.doesNotMatch(fn, /platformCreditActorLimiter\(actorUserId\)/);
  });

  it("fails closed when the shared hash secret cannot be resolved", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");
    const fn = source.slice(source.indexOf("export async function limitPlatformCreditMutation"));

    assert.match(fn, /catch \{\s*\n\s*return RATE_LIMIT_UNAVAILABLE;/);
  });
});

describe("lead capture rate-limit failure policy", () => {
  it("answers an evaluated denial with 429 and an unavailable verdict with 503", () => {
    const source = readFileSync(LEAD_HANDLER, "utf8");

    assert.match(source, /if \(rateLimit === "limited"\) \{\s*\n\s*return rateLimitedResponse\(\);/);
    assert.match(
      source,
      /if \(rateLimit === "unavailable"\) \{\s*\n\s*return serviceUnavailableResponse\(\);/,
    );
  });

  it("preserves all three lead limiters", () => {
    const source = readFileSync(LEAD_HANDLER, "utf8");

    assert.match(source, /limitLeadCaptureBySession\(session\.id\)/);
    assert.match(source, /limitLeadCaptureByIp\(request\)/);
    assert.match(source, /limitLeadCaptureGlobal\(\)/);
    assert.match(source, /combineRateLimitDecisions\(/);
  });

  it("creates no lead and runs no RPC after an unavailable verdict", () => {
    const source = readFileSync(LEAD_HANDLER, "utf8");
    const unavailableIndex = source.indexOf("serviceUnavailableResponse()");
    const rpcIndex = source.indexOf('supabase.rpc("create_try_on_lead"');

    assert.ok(unavailableIndex > -1);
    assert.ok(rpcIndex > -1);
    assert.ok(unavailableIndex < rpcIndex, "the fail-closed return must precede the lead RPC");
  });

  it("no longer swallows limiter failures into a permissive boolean", () => {
    const source = readFileSync(LEAD_HANDLER, "utf8");

    // Body parsing legitimately still uses `parsed.success`; only limiter verdicts changed.
    assert.doesNotMatch(source, /sessionLimit\.success/);
    assert.doesNotMatch(source, /ipLimit\.success/);
    assert.doesNotMatch(source, /globalLimit\.success/);
    assert.doesNotMatch(source, /rateLimit\.success/);
  });
});

describe("try-on session creation rate-limit failure policy", () => {
  it("answers denial with 429 and unavailable with 503", () => {
    const source = readFileSync(SESSION_CREATE_ROUTE, "utf8");

    assert.match(
      source,
      /if \(rate\.outcome === "limited"\) \{\s*\n\s*return rateLimitedResponse\(\);/,
    );
    assert.match(
      source,
      /if \(rate\.outcome === "unavailable"\) \{\s*\n\s*return serviceUnavailableResponse\(\);/,
    );
  });

  it("no longer reports infrastructure failure through a catch-all 503 string", () => {
    const source = readFileSync(SESSION_CREATE_ROUTE, "utf8");

    assert.doesNotMatch(source, /genericErrorResponse\("Service temporarily unavailable\.", 503\)/);
    assert.doesNotMatch(source, /rate\.success/);
  });

  it("creates no session and reserves no credit after an unavailable verdict", () => {
    const source = readFileSync(SESSION_CREATE_ROUTE, "utf8");
    const unavailableIndex = source.indexOf("serviceUnavailableResponse()");
    const createIndex = source.indexOf("createTryOnSession(");

    assert.ok(unavailableIndex > -1);
    assert.ok(createIndex > unavailableIndex, "session creation must follow the verdict");
  });
});

describe("demo rate-limit failure policy", () => {
  it("answers denial with 429 and unavailable with 503 for network limiters", () => {
    const source = readFileSync(DEMO_HANDLER, "utf8");

    assert.match(
      source,
      /if \(networkRateLimit === "limited"\) \{\s*\n\s*return rateLimitedResponse\(\);/,
    );
    assert.match(
      source,
      /if \(networkRateLimit === "unavailable"\) \{\s*\n\s*return serviceUnavailableResponse\(\);/,
    );
  });

  it("answers denial with 429 and unavailable with 503 for the cookie limiter", () => {
    const source = readFileSync(DEMO_HANDLER, "utf8");

    assert.match(
      source,
      /if \(cookieLimit\.outcome === "limited"\) \{\s*\n\s*return rateLimitedResponse\(\);/,
    );
    assert.match(
      source,
      /if \(cookieLimit\.outcome === "unavailable"\) \{\s*\n\s*return serviceUnavailableResponse\(\);/,
    );
  });

  it("no longer converts limiter exceptions into 429", () => {
    const source = readFileSync(DEMO_HANDLER, "utf8");

    assert.doesNotMatch(source, /catch \{\s*\n\s*return rateLimitedResponse\(\);/);
    assert.doesNotMatch(source, /ipLimit\.success|globalLimit\.success|cookieLimit\.success/);
  });

  it("runs no generation after an unavailable verdict", () => {
    const source = readFileSync(DEMO_HANDLER, "utf8");
    const lastUnavailableIndex = source.lastIndexOf("serviceUnavailableResponse()");
    const generateIndex = source.indexOf("generateTryOnImage(");

    assert.ok(lastUnavailableIndex > -1);
    assert.ok(generateIndex > lastUnavailableIndex, "generation must follow every verdict");
  });

  it("preserves the kill switch, same-origin check and 8C.3A multipart bound", () => {
    const source = readFileSync(DEMO_HANDLER, "utf8");

    assert.match(source, /isDemoKillSwitchEnabled\(\)/);
    assert.match(source, /assertSameOrigin\(request\)/);
    assert.match(source, /DEMO_MAX_MULTIPART_BODY_BYTES/);
    assert.match(source, /const MAX_BYTES = 8 \* 1024 \* 1024;/);
  });
});

describe("platform credit mutation limiter", () => {
  it("uses one conservative shared budget of 30 per minute", () => {
    const source = readFileSync(RATE_LIMIT_MODULE, "utf8");

    assert.match(source, /export const PLATFORM_CREDIT_MUTATION_LIMIT = 30;/);
    assert.match(source, /export const PLATFORM_CREDIT_MUTATION_WINDOW = "1 m"/);
    assert.match(source, /export const PLATFORM_CREDIT_ACTOR_NAMESPACE = "platform-credit-actor"/);
  });

  it("shares a single actor bucket between grant and revoke", () => {
    const grant = readFileSync("app/api/platform/credits/grant/route.ts", "utf8");
    const revoke = readFileSync("app/api/platform/credits/revoke/route.ts", "utf8");
    const handler = readFileSync(PLATFORM_HANDLER, "utf8");
    const limiterSource = readFileSync(RATE_LIMIT_MODULE, "utf8");

    // Both routes delegate to the one handler, which calls the one limiter.
    assert.match(grant, /handlePlatformCreditMutation\(request, "grant"\)/);
    assert.match(revoke, /handlePlatformCreditMutation\(request, "revoke"\)/);
    assert.equal(handler.match(/limitPlatformCreditMutation\(/g)?.length, 1);
    assert.equal(
      limiterSource.match(/createUpstashLimiter\(\s*PLATFORM_CREDIT_MUTATION_LIMIT/g)?.length,
      1,
      "a single bucket must not be split per operation",
    );
    assert.doesNotMatch(handler, /limitPlatformCreditMutation\([^)]*operation/);
  });

  it("runs after authentication and platform authorization", () => {
    const source = readFileSync(PLATFORM_HANDLER, "utf8");
    const authnIndex = source.indexOf('genericErrorResponse("Authentication required.", 401)');
    const authzIndex = source.indexOf(
      'genericErrorResponse("Platform administrator access required.", 403)',
    );
    const limiterIndex = source.indexOf("limitPlatformCreditMutation(user.id)");

    assert.ok(authnIndex > -1 && authzIndex > -1 && limiterIndex > -1);
    assert.ok(authnIndex < limiterIndex, "unauthenticated traffic must not consume a bucket");
    assert.ok(authzIndex < limiterIndex, "non-platform-admin traffic must not consume a bucket");
  });

  it("requires platform_admin, so a merchant role alone cannot reach the limiter", () => {
    const source = readFileSync(PLATFORM_HANDLER, "utf8");
    const gateIndex = source.indexOf("isPlatformAdminProfile(profile)");
    const limiterIndex = source.indexOf("limitPlatformCreditMutation(user.id)");

    assert.ok(gateIndex > -1);
    assert.ok(gateIndex < limiterIndex);
    assert.match(source, /loadPlatformAdminProfile\(user\.id\)/);
  });

  it("answers denial with 429 and unavailable with 503", () => {
    const source = readFileSync(PLATFORM_HANDLER, "utf8");

    assert.match(
      source,
      /if \(rate\.outcome === "limited"\) \{\s*\n\s*return rateLimitedResponse\(\);/,
    );
    assert.match(
      source,
      /if \(rate\.outcome === "unavailable"\) \{\s*\n\s*return serviceUnavailableResponse\(\);/,
    );
  });

  it("runs no credit RPC and no ledger mutation when limited or unavailable", () => {
    const source = readFileSync(PLATFORM_HANDLER, "utf8");
    const limitedIndex = source.indexOf("rateLimitedResponse()");
    const unavailableIndex = source.indexOf("serviceUnavailableResponse()");
    const rpcIndex = source.indexOf("admin.rpc(rpcName");

    assert.ok(rpcIndex > -1);
    assert.ok(limitedIndex < rpcIndex, "429 must return before the credit RPC");
    assert.ok(unavailableIndex < rpcIndex, "503 must return before the credit RPC");
  });

  it("passes the limiter before body validation so a looping client cannot flood the database", () => {
    const source = readFileSync(PLATFORM_HANDLER, "utf8");
    const limiterIndex = source.indexOf("limitPlatformCreditMutation(user.id)");
    const parseIndex = source.indexOf("parsePlatformCreditMutationBody(body)");

    assert.ok(limiterIndex < parseIndex);
  });

  it("keeps p_actor server-derived and unreachable from the browser", () => {
    const source = readFileSync(PLATFORM_HANDLER, "utf8");
    const validation = readFileSync("lib/platform/validation.ts", "utf8");

    assert.match(source, /p_actor: user\.id,/);
    assert.match(validation, /actor/);
  });

  it("leaves the credit RPC arguments and idempotency untouched", () => {
    const source = readFileSync(PLATFORM_HANDLER, "utf8");

    for (const argument of [
      "p_brand_id: parsed.data.brandId",
      "p_amount: parsed.data.amount",
      "p_idempotency_key: parsed.data.idempotencyKey",
      "p_reason: parsed.data.reason",
      "p_actor: user.id",
    ]) {
      assert.ok(source.includes(argument), `unchanged RPC argument: ${argument}`);
    }
  });
});

describe("rate-limit client response privacy", () => {
  it("keeps the 503 body generic and no-store", () => {
    const source = readFileSync("lib/api/security.ts", "utf8");
    const helper = source.slice(source.indexOf("export function serviceUnavailableResponse"));

    assert.match(helper, /jsonNoStore\(/);
    assert.match(helper, /status: 503/);
    assert.match(helper, /Service temporarily unavailable\./);
  });

  it("leaks no provider, credential or network detail to clients", () => {
    const forbidden = /upstash|redis|timeout|credential|dns|econnrefused|x-forwarded-for/i;

    for (const file of [LEAD_HANDLER, SESSION_CREATE_ROUTE, DEMO_HANDLER, PLATFORM_HANDLER]) {
      const source = readFileSync(file, "utf8");
      const clientMessages = [...source.matchAll(/genericErrorResponse\("([^"]+)"/g)].map(
        (match) => match[1],
      );

      for (const message of clientMessages) {
        assert.doesNotMatch(message, forbidden, `${file} leaks detail: ${message}`);
      }
    }

    const security = readFileSync("lib/api/security.ts", "utf8");
    const helper = security.slice(
      security.indexOf("export function serviceUnavailableResponse"),
      security.length,
    );
    const body = helper.match(/error: "([^"]+)"/)?.[1] ?? "";

    assert.doesNotMatch(body, forbidden);
  });
});
