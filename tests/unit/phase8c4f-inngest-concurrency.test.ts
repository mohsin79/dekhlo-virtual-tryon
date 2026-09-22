import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DEFAULT_INNGEST_TRY_ON_CONCURRENCY,
  getInngestTryOnConcurrency,
  resolveInngestTryOnConcurrency,
} from "../../lib/inngest/env";

const processSource = readFileSync(
  new URL("../../lib/inngest/functions/process-try-on-generation.ts", import.meta.url),
  "utf8",
);
const cleanupSource = readFileSync(
  new URL("../../lib/inngest/functions/cleanup-expired-try-on-artifacts.ts", import.meta.url),
  "utf8",
);

function withEnv<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.INNGEST_TRY_ON_CONCURRENCY;
  if (value === undefined) {
    delete process.env.INNGEST_TRY_ON_CONCURRENCY;
  } else {
    process.env.INNGEST_TRY_ON_CONCURRENCY = value;
  }
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.INNGEST_TRY_ON_CONCURRENCY;
    } else {
      process.env.INNGEST_TRY_ON_CONCURRENCY = previous;
    }
  }
}

describe("Phase 8C.4F — INNGEST_TRY_ON_CONCURRENCY default", () => {
  it("preserves the previously hard-coded value as the default", () => {
    assert.equal(DEFAULT_INNGEST_TRY_ON_CONCURRENCY, 8);
  });

  it("returns 8 when the variable is absent", () => {
    assert.equal(resolveInngestTryOnConcurrency({}), 8);
  });

  it("returns 8 when the variable is empty", () => {
    assert.equal(resolveInngestTryOnConcurrency({ INNGEST_TRY_ON_CONCURRENCY: "" }), 8);
  });

  it("returns 8 when the variable is whitespace only", () => {
    assert.equal(resolveInngestTryOnConcurrency({ INNGEST_TRY_ON_CONCURRENCY: "   " }), 8);
    assert.equal(resolveInngestTryOnConcurrency({ INNGEST_TRY_ON_CONCURRENCY: "\t\n" }), 8);
  });
});

describe("Phase 8C.4F — INNGEST_TRY_ON_CONCURRENCY valid values", () => {
  it('"5" resolves to 5 (staging Hobby plan)', () => {
    assert.equal(resolveInngestTryOnConcurrency({ INNGEST_TRY_ON_CONCURRENCY: "5" }), 5);
  });

  it('"8" resolves to 8', () => {
    assert.equal(resolveInngestTryOnConcurrency({ INNGEST_TRY_ON_CONCURRENCY: "8" }), 8);
  });

  it('"1" resolves to 1', () => {
    assert.equal(resolveInngestTryOnConcurrency({ INNGEST_TRY_ON_CONCURRENCY: "1" }), 1);
  });

  it("tolerates surrounding whitespace around a valid value", () => {
    assert.equal(resolveInngestTryOnConcurrency({ INNGEST_TRY_ON_CONCURRENCY: " 5 " }), 5);
  });

  it("does not impose a plan-specific ceiling in code", () => {
    assert.equal(resolveInngestTryOnConcurrency({ INNGEST_TRY_ON_CONCURRENCY: "64" }), 64);
  });
});

describe("Phase 8C.4F — INNGEST_TRY_ON_CONCURRENCY rejects invalid values", () => {
  const invalid: Array<[label: string, value: string]> = [
    ["zero", "0"],
    ["negative", "-1"],
    ["fraction", "1.5"],
    ["letters", "abc"],
    ["NaN literal", "NaN"],
    ["Infinity literal", "Infinity"],
    ["explicit plus sign", "+5"],
    ["exponent notation", "1e2"],
    ["hex notation", "0x8"],
    ["trailing garbage", "5abc"],
    ["embedded whitespace", "1 0"],
  ];

  for (const [label, value] of invalid) {
    it(`rejects ${label} (${JSON.stringify(value)}) instead of falling back to 8`, () => {
      assert.throws(
        () => resolveInngestTryOnConcurrency({ INNGEST_TRY_ON_CONCURRENCY: value }),
        /INNGEST_TRY_ON_CONCURRENCY/,
      );
    });
  }

  it("never leaks the rejected value into the error message", () => {
    assert.throws(
      () => resolveInngestTryOnConcurrency({ INNGEST_TRY_ON_CONCURRENCY: "zzz-secret-ish" }),
      (err: unknown) => err instanceof Error && !err.message.includes("zzz-secret-ish"),
    );
  });
});

describe("Phase 8C.4F — process.env-backed accessor", () => {
  it("reads process.env at call time", () => {
    assert.equal(withEnv(undefined, () => getInngestTryOnConcurrency()), 8);
    assert.equal(withEnv("5", () => getInngestTryOnConcurrency()), 5);
    assert.throws(() => withEnv("0", () => getInngestTryOnConcurrency()));
  });
});

describe("Phase 8C.4F — process-try-on-generation wiring", () => {
  it("uses the accessor for the global concurrency limit", () => {
    assert.match(processSource, /import \{ getInngestTryOnConcurrency \} from "@\/lib\/inngest\/env"/);
    assert.match(processSource, /\{ limit: getInngestTryOnConcurrency\(\) \}/);
  });

  it("no longer hard-codes the global limit", () => {
    assert.doesNotMatch(processSource, /\{ limit: 8 \}/);
  });

  it("keeps the per-session limit of 1 keyed on the session id", () => {
    assert.match(processSource, /\{ limit: 1, key: "event\.data\.sessionId" \}/);
  });

  it("does not remove or disable concurrency control", () => {
    assert.doesNotMatch(processSource, /limit: undefined/);
    assert.doesNotMatch(processSource, /limit: 0\b/);
    assert.doesNotMatch(processSource, /concurrency: undefined/);
  });

  it("leaves function id, trigger and retries unchanged", () => {
    assert.match(processSource, /id: "process-try-on-generation"/);
    assert.match(processSource, /triggers: \[\{ event: TRY_ON_GENERATION_REQUESTED \}\]/);
    assert.match(processSource, /const GENERATION_RETRIES = 3;/);
    assert.match(processSource, /retries: GENERATION_RETRIES/);
  });

  it("leaves every step id unchanged", () => {
    for (const stepId of [
      "release-after-final-failure",
      "load-and-validate-session",
      "claim-processing-state",
      "download-person-photo",
      "obtain-product-image",
      "generate-try-on-result",
      "record-provider-request-id",
      "upload-result",
      "persist-result-path",
      "consume-reserved-credit",
      "finalize-session",
    ]) {
      assert.ok(processSource.includes(`"${stepId}"`), `missing step id ${stepId}`);
    }
  });
});

describe("Phase 8C.4F — cleanup-expired-try-on-artifacts unchanged", () => {
  it("does not reference the new accessor or declare concurrency", () => {
    assert.doesNotMatch(cleanupSource, /getInngestTryOnConcurrency/);
    assert.doesNotMatch(cleanupSource, /INNGEST_TRY_ON_CONCURRENCY/);
    assert.doesNotMatch(cleanupSource, /concurrency/);
  });

  it("keeps its id and hourly cron trigger", () => {
    assert.match(cleanupSource, /id: "cleanup-expired-try-on-artifacts"/);
    assert.match(cleanupSource, /triggers: \[\{ cron: "0 \* \* \* \*" \}\]/);
  });
});
