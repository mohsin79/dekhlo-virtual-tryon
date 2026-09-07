import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  HEALTH_PROBE_TABLE,
  HEALTH_PROBE_TIMEOUT_MS,
  probeSupabaseReadiness,
  type ReadinessProbeClient,
} from "@/lib/supabase/health";

const HEALTH_MODULE = "lib/supabase/health.ts";
const HEALTH_ROUTE = "app/api/health/supabase/route.ts";

type Recorded = {
  table?: string;
  columns?: string;
  limit?: number;
  signal?: AbortSignal;
};

/**
 * Fake client capturing the request shape. `outcome` either resolves like PostgREST or
 * throws like a transport failure.
 */
function fakeClient(
  outcome: { data?: unknown; error: unknown } | (() => never),
  recorded: Recorded = {},
): ReadinessProbeClient {
  return {
    from(table) {
      recorded.table = table;
      return {
        select(columns) {
          recorded.columns = columns;
          return {
            limit(count) {
              recorded.limit = count;
              return {
                abortSignal(signal) {
                  recorded.signal = signal;
                  return typeof outcome === "function"
                    ? Promise.reject(new Error("transport failure"))
                    : Promise.resolve(outcome);
                },
              };
            },
          };
        },
      };
    },
  };
}

const THROWS = () => {
  throw new Error("transport failure");
};

describe("Supabase readiness probe outcome", () => {
  it("reports healthy when the provider answers without an error", async () => {
    const outcome = { data: [{ id: "0d1f6b1e-0000-4000-8000-000000000000" }], error: null };

    assert.equal(await probeSupabaseReadiness(fakeClient(outcome)), true);
  });

  it("reports healthy when the query succeeds but matches zero rows", async () => {
    // Reachability is the signal, not the presence of data, so an empty table is healthy.
    assert.equal(await probeSupabaseReadiness(fakeClient({ data: [], error: null })), true);
  });

  it("reports unhealthy when the provider returns an error", async () => {
    const errors = [
      { message: "relation does not exist", code: "42P01" },
      { message: "JWT expired", code: "PGRST301" },
      { message: "permission denied", code: "42501" },
    ];

    for (const error of errors) {
      assert.equal(await probeSupabaseReadiness(fakeClient({ error })), false);
    }
  });

  it("reports unhealthy when the request throws a transport failure", async () => {
    assert.equal(await probeSupabaseReadiness(fakeClient(THROWS)), false);
  });

  it("reports unhealthy when the request is aborted by the timeout", async () => {
    const aborting: ReadinessProbeClient = {
      from: () => ({
        select: () => ({
          limit: () => ({
            abortSignal: () =>
              Promise.resolve({
                error: { message: "AbortError: The operation was aborted due to timeout" },
              }),
          }),
        }),
      }),
    };

    assert.equal(await probeSupabaseReadiness(aborting), false);
  });

  it("returns only a boolean, never provider or row data", async () => {
    const result = await probeSupabaseReadiness(
      fakeClient({ error: null }),
    );

    assert.equal(typeof result, "boolean");
  });
});

describe("Supabase readiness probe request shape", () => {
  it("selects at most one id from the stable brands table", async () => {
    const recorded: Recorded = {};

    await probeSupabaseReadiness(fakeClient({ error: null }, recorded));

    assert.equal(recorded.table, "brands");
    assert.equal(HEALTH_PROBE_TABLE, "brands");
    assert.equal(recorded.limit, 1, "at most one row");
    assert.equal(recorded.columns, "id", "only an opaque identifier column");
  });

  it("passes an abort signal so a provider outage cannot hang the endpoint", async () => {
    const recorded: Recorded = {};

    await probeSupabaseReadiness(fakeClient({ error: null }, recorded), 1234);

    assert.ok(recorded.signal instanceof AbortSignal);
    assert.equal(recorded.signal?.aborted, false);
    assert.equal(HEALTH_PROBE_TIMEOUT_MS, 5000);
  });

  it("performs no mutation, RPC, credit or lead operation", () => {
    const source = readFileSync(HEALTH_MODULE, "utf8");

    for (const forbidden of [".insert(", ".update(", ".delete(", ".upsert(", ".rpc("]) {
      assert.equal(source.includes(forbidden), false, `probe must not call ${forbidden}`);
    }
  });
});

describe("the getSession false positive cannot return", () => {
  it("no longer uses auth.getSession as the connectivity proof", () => {
    const source = readFileSync(HEALTH_MODULE, "utf8");
    const code = source
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
      })
      .join("\n");

    assert.doesNotMatch(code, /getSession\(\)/);
    assert.doesNotMatch(code, /auth\./);
    // The probe must go through the database/PostgREST path.
    assert.match(code, /\.from\(HEALTH_PROBE_TABLE\)/);
  });

  it("cannot report healthy against an unreachable origin", async () => {
    // Loopback port 1 refuses instantly; no internet access is required for this test.
    const client = createClient("http://127.0.0.1:1", "probe-key", {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const healthy = await probeSupabaseReadiness(
      client as unknown as ReadinessProbeClient,
      400,
    );

    assert.equal(healthy, false, "an unreachable Supabase must never report healthy");
  });

  it("bounds an unreachable origin within the supplied timeout", async () => {
    // postgrest-js retries network errors with backoff, so the abort signal is what caps
    // total probe time rather than the retry budget.
    const client = createClient("http://127.0.0.1:1", "probe-key", {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const started = Date.now();
    await probeSupabaseReadiness(client as unknown as ReadinessProbeClient, 400);
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 3000, `probe should be bounded, took ${elapsed}ms`);
  });
});

describe("health endpoint contract", () => {
  it("keeps the response body minimal with no provider detail", () => {
    const source = readFileSync(HEALTH_ROUTE, "utf8");
    const bodies = [...source.matchAll(/healthResponse\(\{ status: "(ok|error)" \}, (\d+)\)/g)].map(
      (match) => `${match[1]}:${match[2]}`,
    );

    assert.ok(bodies.includes("ok:200"), "healthy is 200 {status: ok}");
    assert.ok(bodies.includes("error:503"), "dependency unavailable is 503 {status: error}");
    assert.ok(bodies.includes("error:404"), "unauthorized health access stays 404");

    for (const forbidden of [
      "error.message",
      "String(error",
      "supabase.co",
      "brands",
      "SUPABASE",
      "stack",
    ]) {
      assert.equal(
        source.includes(forbidden),
        false,
        `route must not expose ${forbidden}`,
      );
    }
  });

  it("preserves no-store caching", () => {
    const source = readFileSync(HEALTH_ROUTE, "utf8");

    assert.match(source, /"Cache-Control": "no-store"/);
  });

  it("preserves the INTERNAL_HEALTH_SECRET authorization behavior", () => {
    const source = readFileSync(HEALTH_ROUTE, "utf8");

    assert.match(source, /process\.env\.NODE_ENV === "development"/);
    assert.match(source, /getInternalHealthSecret\(\)/);
    assert.match(source, /if \(!secret\) \{\s*\n\s*return false;/);
    assert.match(source, /request\.headers\.get\("x-internal-health-secret"\) === secret/);
  });

  it("treats an unavailable dependency as 503 rather than a thrown 500", () => {
    const source = readFileSync(HEALTH_ROUTE, "utf8");
    const handler = source.slice(source.indexOf("export async function GET"));

    assert.match(handler, /catch \{\s*\n\s*return healthResponse\(\{ status: "error" \}, 503\);/);
    assert.match(handler, /const ok = await verifySupabaseConnection\(\);/);
  });
});

describe("health endpoint runtime behavior", () => {
  const env = process.env as Record<string, string | undefined>;

  async function callHealthRoute(
    overrides: Record<string, string | undefined>,
    headers: Record<string, string> = {},
  ) {
    const previous: Record<string, string | undefined> = {};

    for (const [key, value] of Object.entries(overrides)) {
      previous[key] = env[key];
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }

    try {
      const { GET } = await import("@/app/api/health/supabase/route");
      return await GET(new Request("http://localhost/api/health/supabase", { headers }));
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete env[key];
        } else {
          env[key] = value;
        }
      }
    }
  }

  it("returns 404 when no health secret is configured outside development", async () => {
    const response = await callHealthRoute({
      NODE_ENV: "production",
      INTERNAL_HEALTH_SECRET: undefined,
    });

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { status: "error" });
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("returns 404 when the health secret header does not match", async () => {
    const response = await callHealthRoute(
      { NODE_ENV: "production", INTERNAL_HEALTH_SECRET: "expected-secret" },
      { "x-internal-health-secret": "wrong-secret" },
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { status: "error" });
  });

  it("returns 503 with a generic body when Supabase cannot be reached", async () => {
    // The admin client cannot be constructed in this environment, which the probe reports
    // as unhealthy rather than allowing an exception to surface as a 500.
    const response = await callHealthRoute(
      { NODE_ENV: "production", INTERNAL_HEALTH_SECRET: "expected-secret" },
      { "x-internal-health-secret": "expected-secret" },
    );

    assert.equal(response.status, 503);

    const body = await response.json();

    assert.deepEqual(body, { status: "error" });
    assert.deepEqual(Object.keys(body), ["status"], "no extra diagnostic fields");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});
