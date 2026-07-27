import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getLeadRateLimitHashSecret, resolveLeadRateLimitHashSecret } from "@/lib/env";
import {
  assertExactResponseKeys,
  buildLeadGetResponse,
  buildLeadPostResponse,
  LEAD_GET_RESPONSE_KEYS,
  LEAD_POST_RESPONSE_KEYS,
} from "@/lib/leads/public-response";
import { hashLeadRateLimitIp } from "@/lib/rate-limit/lead-ip-hash";

describe("lead public response contract", () => {
  it("GET response contains only submitted", () => {
    const body = buildLeadGetResponse(true);
    assertExactResponseKeys(body, LEAD_GET_RESPONSE_KEYS);
    assert.equal(body.submitted, true);

    const notSubmitted = buildLeadGetResponse(false);
    assertExactResponseKeys(notSubmitted, LEAD_GET_RESPONSE_KEYS);
    assert.equal(notSubmitted.submitted, false);
  });

  it("POST response contains only leadId and wasCreated", () => {
    const body = buildLeadPostResponse("550e8400-e29b-41d4-a716-446655440000", true);
    assertExactResponseKeys(body, LEAD_POST_RESPONSE_KEYS);
    assert.equal(body.wasCreated, true);
  });
});

describe("lead rate-limit IP hashing", () => {
  it("hashes with an injected secret and never returns the secret", () => {
    const secret = "test-only-hash-secret";
    const hashA = hashLeadRateLimitIp("203.0.113.10", secret);
    const hashB = hashLeadRateLimitIp("203.0.113.10", secret);

    assert.equal(hashA, hashB);
    assert.equal(hashA.includes(secret), false);
    assert.match(hashA, /^[0-9a-f]{64}$/);
  });

  it("uses LEAD_RATE_LIMIT_HASH_SECRET when set", () => {
    assert.equal(
      resolveLeadRateLimitHashSecret({
        LEAD_RATE_LIMIT_HASH_SECRET: "unit-test-hash-secret",
      }),
      "unit-test-hash-secret",
    );
  });

  it("fails closed in production when LEAD_RATE_LIMIT_HASH_SECRET is missing", () => {
    assert.throws(
      () =>
        resolveLeadRateLimitHashSecret({
          NODE_ENV: "production",
        }),
      /LEAD_RATE_LIMIT_HASH_SECRET/,
    );
  });

  it("getLeadRateLimitHashSecret reads from process env when set", () => {
    const previous = process.env.LEAD_RATE_LIMIT_HASH_SECRET;
    process.env.LEAD_RATE_LIMIT_HASH_SECRET = "runtime-test-secret";

    try {
      assert.equal(getLeadRateLimitHashSecret(), "runtime-test-secret");
    } finally {
      if (previous === undefined) {
        delete process.env.LEAD_RATE_LIMIT_HASH_SECRET;
      } else {
        process.env.LEAD_RATE_LIMIT_HASH_SECRET = previous;
      }
    }
  });
});

describe("lead capture handler side-effect boundaries", () => {
  it("does not reference credit, generation, storage or provider RPCs", () => {
    const source = readFileSync("lib/leads/handle-lead-capture.ts", "utf8");

    const forbidden = [
      "queue_try_on_session",
      "consume_reserved_brand_credits",
      "release_reserved_brand_credits",
      "grant_brand_credits",
      "admin_grant_brand_credits",
      "admin_revoke_brand_credits",
      "dispatchTryOnGeneration",
      "inngest",
      "openai",
      "removePersonPhoto",
      "removeTryOnResult",
    ];

    for (const needle of forbidden) {
      assert.equal(source.toLowerCase().includes(needle.toLowerCase()), false, `unexpected reference: ${needle}`);
    }

    assert.match(source, /create_try_on_lead/);
  });
});
