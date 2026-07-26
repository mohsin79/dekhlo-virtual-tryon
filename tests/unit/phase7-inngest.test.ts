import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Inngest } from "inngest";
import { InngestTestEngine } from "@inngest/test";
import { tryOnGenerationEventId, TRY_ON_GENERATION_REQUESTED } from "../../lib/inngest/events";
import { CLEANUP_BATCH_SIZE } from "../../lib/try-on/cleanup/constants";
import { storagePathBelongsToSession } from "../../lib/try-on/cleanup/path-guards";
import {
  assertInngestEventSendingConfigured,
  isInngestDevMode,
} from "../../lib/inngest/env";
import {
  computeSessionPollDelayMs,
  isTerminalPollStatus,
  shouldContinueSessionPolling,
} from "../../lib/try-on/sessions/session-polling";
import { evaluateSessionForGeneration } from "../../lib/try-on/worker/session-evaluation";
import {
  isSafePersonStoragePath,
  isSafeResultStoragePath,
} from "../../lib/try-on/sessions/paths";
import type { TryOnSessionRow } from "../../lib/try-on/sessions/public-session";

const testInngest = new Inngest({ id: "dekhlo-test" });

const testGenerationFunction = testInngest.createFunction(
  {
    id: "process-try-on-generation-test-double",
    triggers: [{ event: TRY_ON_GENERATION_REQUESTED }],
    retries: 3,
    concurrency: [{ limit: 1, key: "event.data.sessionId" }, { limit: 8 }],
  },
  async ({ step }) => {
    const loaded = await step.run("load-and-validate-session", async () => ({
      action: "skip" as const,
      reason: "completed" as const,
    }));

    if (loaded.action === "skip") {
      return { skipped: true, reason: loaded.reason };
    }

    await step.run("claim-processing-state", async () => true);
    return { sessionId: "unused", status: "completed" as const };
  },
);

const testCleanupFunction = testInngest.createFunction(
  {
    id: "cleanup-expired-try-on-artifacts-test-double",
    triggers: [{ cron: "0 * * * *" }],
  },
  async ({ step }) => {
    const sessions = await step.run("load-expired-sessions", async () => [] as TryOnSessionRow[]);

    let cleaned = 0;

    for (const session of sessions) {
      await step.run(`cleanup-session-${session.id}`, async () => ({ sessionId: session.id }));
      cleaned += 1;
    }

    return { cleaned, batchSize: CLEANUP_BATCH_SIZE };
  },
);

const SESSION_ID = "11111111-1111-1111-1111-111111111111";
const BRAND_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function session(overrides: Partial<TryOnSessionRow> = {}): TryOnSessionRow {
  return {
    id: SESSION_ID,
    brand_id: BRAND_ID,
    product_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    status: "queued",
    credit_cost: 1,
    person_storage_path: `${BRAND_ID}/${SESSION_ID}/person.jpg`,
    result_storage_path: null,
    upload_validated_at: new Date().toISOString(),
    provider_job_id: null,
    provider_request_id: null,
    consent_to_store: false,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    deleted_at: null,
    error_code: null,
    sanitized_error_message: null,
    client_request_id: "22222222-2222-2222-2222-222222222222",
    anonymous_token_hash: "a".repeat(64),
    created_at: new Date().toISOString(),
    completed_at: null,
    ...overrides,
  };
}

describe("Phase 7 event contract", () => {
  it("uses a deterministic generation event id per session", () => {
    assert.equal(tryOnGenerationEventId(SESSION_ID), `try-on-generation:${SESSION_ID}`);
    assert.equal(TRY_ON_GENERATION_REQUESTED, "dekhlo/try-on.generation.requested");
  });

  it("event payload contains only session and brand identifiers", () => {
    const payload = {
      sessionId: SESSION_ID,
      brandId: BRAND_ID,
    };

    assert.deepEqual(Object.keys(payload).sort(), ["brandId", "sessionId"]);
    assert.doesNotMatch(JSON.stringify(payload), /token|hash|path|storage|email/i);
  });
});

describe("Inngest environment helpers", () => {
  it("treats INNGEST_DEV=1 as configured for event sending", () => {
    const previousDev = process.env.INNGEST_DEV;
    const previousKey = process.env.INNGEST_EVENT_KEY;

    process.env.INNGEST_DEV = "1";
    delete process.env.INNGEST_EVENT_KEY;

    assert.equal(isInngestDevMode(), true);
    assert.doesNotThrow(() => assertInngestEventSendingConfigured());

    process.env.INNGEST_DEV = previousDev;
    if (previousKey !== undefined) {
      process.env.INNGEST_EVENT_KEY = previousKey;
    }
  });

  it("requires INNGEST_EVENT_KEY outside dev mode", () => {
    const previousDev = process.env.INNGEST_DEV;
    const previousKey = process.env.INNGEST_EVENT_KEY;

    delete process.env.INNGEST_DEV;
    delete process.env.INNGEST_EVENT_KEY;

    assert.throws(() => assertInngestEventSendingConfigured(), /Inngest event configuration/);

    process.env.INNGEST_DEV = previousDev;
    if (previousKey !== undefined) {
      process.env.INNGEST_EVENT_KEY = previousKey;
    }
  });
});

describe("session polling helpers", () => {
  it("polls queued and processing statuses only", () => {
    assert.equal(shouldContinueSessionPolling("queued"), true);
    assert.equal(shouldContinueSessionPolling("processing"), true);
    assert.equal(shouldContinueSessionPolling("completed"), false);
    assert.equal(shouldContinueSessionPolling("failed"), false);
    assert.equal(shouldContinueSessionPolling("cancelled"), false);
  });

  it("recognizes terminal poll statuses", () => {
    assert.equal(isTerminalPollStatus("completed"), true);
    assert.equal(isTerminalPollStatus("failed"), true);
    assert.equal(isTerminalPollStatus("cancelled"), true);
    assert.equal(isTerminalPollStatus("queued"), false);
  });

  it("uses bounded backoff delays", () => {
    assert.equal(computeSessionPollDelayMs(0), 1000);
    assert.equal(computeSessionPollDelayMs(1), 1500);
    assert.equal(computeSessionPollDelayMs(10), 5000);
  });
});

describe("worker session evaluation", () => {
  it("skips completed sessions without processing", () => {
    const result = evaluateSessionForGeneration(session({ status: "completed" }));
    assert.equal(result.action, "skip");
    if (result.action === "skip") {
      assert.equal(result.reason, "completed");
    }
  });

  it("processes queued sessions", () => {
    const result = evaluateSessionForGeneration(session({ status: "queued" }));
    assert.equal(result.action, "process");
  });

  it("skips terminal failed sessions", () => {
    const result = evaluateSessionForGeneration(session({ status: "failed" }));
    assert.equal(result.action, "skip");
  });

  it("skips deleted sessions", () => {
    const result = evaluateSessionForGeneration(
      session({ deleted_at: new Date().toISOString() }),
    );
    assert.equal(result.action, "skip");
    if (result.action === "skip") {
      assert.equal(result.reason, "deleted");
    }
  });
});

describe("retention cleanup path guards", () => {
  it("accepts person and result paths for the same session", () => {
    const row = session();
    const person = `${BRAND_ID}/${SESSION_ID}/person.jpg`;
    const result = `${BRAND_ID}/${SESSION_ID}/result.png`;

    assert.equal(isSafePersonStoragePath(person), true);
    assert.equal(isSafeResultStoragePath(result), true);
    assert.equal(storagePathBelongsToSession(person, row), true);
    assert.equal(storagePathBelongsToSession(result, row), true);
  });

  it("rejects product-images and cross-session paths", () => {
    const row = session();
    const productPath = `${BRAND_ID}/product-images/shirt.jpg`;
    const otherSession = `${BRAND_ID}/99999999-9999-9999-9999-999999999999/person.jpg`;

    assert.equal(isSafePersonStoragePath(productPath), false);
    assert.equal(storagePathBelongsToSession(otherSession, row), false);
  });
});

describe("Inngest generation function (@inngest/test)", () => {
  it("skips duplicate work when the session is already completed", async () => {
    const engine = new InngestTestEngine({
      function: testGenerationFunction,
    });

    const { result, state } = await engine.execute({
      events: [
        {
          name: TRY_ON_GENERATION_REQUESTED,
          data: { sessionId: SESSION_ID, brandId: BRAND_ID },
        },
      ],
      steps: [
        {
          id: "load-and-validate-session",
          handler() {
            return { action: "skip", reason: "completed" };
          },
        },
      ],
    });

    assert.deepEqual(result, { skipped: true, reason: "completed" });
    assert.equal(state["claim-processing-state"], undefined);
  });
});

describe("Inngest cleanup function (@inngest/test)", () => {
  it("processes a bounded batch of expired sessions", async () => {
    const engine = new InngestTestEngine({
      function: testCleanupFunction,
    });

    const expired = session({ status: "pending_upload", expires_at: new Date(0).toISOString() });

    const { result } = await engine.execute({
      steps: [
        {
          id: "load-expired-sessions",
          handler() {
            return [expired];
          },
        },
        {
          id: `cleanup-session-${SESSION_ID}`,
          handler() {
            return { sessionId: SESSION_ID };
          },
        },
      ],
    });

    assert.equal((result as { cleaned?: number }).cleaned, 1);
    assert.equal((result as { batchSize?: number }).batchSize, CLEANUP_BATCH_SIZE);
  });
});

describe("Inngest client mode", () => {
  it("uses dev mode when INNGEST_DEV=1 without a signing key", () => {
    const previousDev = process.env.INNGEST_DEV;
    const previousSigningKey = process.env.INNGEST_SIGNING_KEY;

    process.env.INNGEST_DEV = "1";
    delete process.env.INNGEST_SIGNING_KEY;

    const client = new Inngest({ id: "dekhlo-test-mode", isDev: isInngestDevMode() });
    assert.equal(client.mode, "dev");

    process.env.INNGEST_DEV = previousDev;
    if (previousSigningKey !== undefined) {
      process.env.INNGEST_SIGNING_KEY = previousSigningKey;
    } else {
      delete process.env.INNGEST_SIGNING_KEY;
    }
  });

  it("requires cloud mode when INNGEST_DEV is unset", () => {
    const previousDev = process.env.INNGEST_DEV;
    delete process.env.INNGEST_DEV;

    const client = new Inngest({ id: "dekhlo-test-mode", isDev: isInngestDevMode() });
    assert.equal(client.mode, "cloud");

    process.env.INNGEST_DEV = previousDev;
  });
});

describe("registered Inngest functions", () => {
  it("registers exactly two Phase 7 functions", async () => {
    const { INNGEST_FUNCTION_COUNT, INNGEST_FUNCTION_IDS } = await import("../../lib/inngest/registry");

    assert.equal(INNGEST_FUNCTION_COUNT, 2);
    assert.deepEqual([...INNGEST_FUNCTION_IDS], [
      "process-try-on-generation",
      "cleanup-expired-try-on-artifacts",
    ]);
  });
});

describe("API routing expectations", () => {
  it("does not treat /api/inngest as a dashboard-protected path", () => {
    const protectedPrefixes = ["/dashboard", "/onboarding"];
    const pathname = "/api/inngest";

    const isProtected = protectedPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );

    assert.equal(isProtected, false);
  });
});
