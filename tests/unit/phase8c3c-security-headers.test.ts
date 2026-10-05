import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  securityHeadersFromEnv,
  toCspOrigin,
} from "@/lib/security/headers.mjs";

const SUPABASE_URL = "https://abcdefgh.supabase.co";
const SUPABASE_ORIGIN = "https://abcdefgh.supabase.co";
const POSTHOG_HOST = "https://us.i.posthog.com";

const HEADERS_MODULE = "lib/security/headers.mjs";
const NEXT_CONFIG = "next.config.mjs";

type Header = { key: string; value: string };

function production(): Header[] {
  return buildSecurityHeaders({
    isProduction: true,
    supabaseUrl: SUPABASE_URL,
    posthogHost: POSTHOG_HOST,
  });
}

function development(): Header[] {
  return buildSecurityHeaders({
    isProduction: false,
    supabaseUrl: "http://127.0.0.1:54321",
    posthogHost: undefined,
  });
}

function headerValue(headers: Header[], key: string): string | undefined {
  return headers.find((header) => header.key.toLowerCase() === key.toLowerCase())?.value;
}

function productionCsp(): string {
  return buildContentSecurityPolicy({
    isProduction: true,
    supabaseUrl: SUPABASE_URL,
    posthogHost: POSTHOG_HOST,
  });
}

/** Splits a policy into directive -> source tokens. */
function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(";").map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources] as [string, string[]];
    }),
  );
}

describe("low-risk security headers", () => {
  it("sets X-Content-Type-Options to nosniff", () => {
    assert.equal(headerValue(production(), "X-Content-Type-Options"), "nosniff");
    assert.equal(headerValue(development(), "X-Content-Type-Options"), "nosniff");
  });

  it("sets Referrer-Policy to strict-origin-when-cross-origin", () => {
    assert.equal(
      headerValue(production(), "Referrer-Policy"),
      "strict-origin-when-cross-origin",
    );
    assert.equal(
      headerValue(development(), "Referrer-Policy"),
      "strict-origin-when-cross-origin",
    );
  });

  it("allows the device camera to self while denying geolocation and microphone", () => {
    const policy = headerValue(production(), "Permissions-Policy") ?? "";

    // camera=(self) rather than camera=(): shopper image capture may use the local camera.
    assert.match(policy, /camera=\(self\)/);
    assert.match(policy, /geolocation=\(\)/);
    assert.match(policy, /microphone=\(\)/);
    assert.doesNotMatch(policy, /camera=\(\)/);
  });

  it("emits HSTS in production only, without preload", () => {
    const hsts = headerValue(production(), "Strict-Transport-Security");

    assert.equal(hsts, "max-age=31536000; includeSubDomains");
    assert.doesNotMatch(hsts ?? "", /preload/);
    assert.equal(headerValue(development(), "Strict-Transport-Security"), undefined);
  });

  it("derives headers from NODE_ENV and public configuration only", () => {
    const fromProd = securityHeadersFromEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_POSTHOG_HOST: POSTHOG_HOST,
    });
    const fromDev = securityHeadersFromEnv({
      NODE_ENV: "development",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    });

    assert.ok(headerValue(fromProd, "Strict-Transport-Security"));
    assert.equal(headerValue(fromDev, "Strict-Transport-Security"), undefined);
    assert.match(headerValue(fromProd, "Content-Security-Policy-Report-Only") ?? "", /supabase/);
  });
});

describe("CSP is report-only", () => {
  it("emits Content-Security-Policy-Report-Only", () => {
    assert.ok(headerValue(production(), "Content-Security-Policy-Report-Only"));
    assert.ok(headerValue(development(), "Content-Security-Policy-Report-Only"));
  });

  it("never emits an enforcing Content-Security-Policy header", () => {
    for (const headers of [production(), development()]) {
      const enforcing = headers.filter(
        (header) => header.key.toLowerCase() === "content-security-policy",
      );

      assert.equal(enforcing.length, 0, "enforcement is deferred beyond Phase 8C.3");
    }

    const source = readFileSync(HEADERS_MODULE, "utf8");

    assert.doesNotMatch(source, /key: "Content-Security-Policy"/);
  });

  it("does not invent report-uri or report-to infrastructure", () => {
    const policy = productionCsp();

    assert.doesNotMatch(policy, /report-uri/);
    assert.doesNotMatch(policy, /report-to/);
  });
});

describe("CSP baseline directives", () => {
  it("locks down the fetch, base and form defaults", () => {
    const parsed = directives(productionCsp());

    assert.deepEqual(parsed.get("default-src"), ["'self'"]);
    assert.deepEqual(parsed.get("base-uri"), ["'self'"]);
    assert.deepEqual(parsed.get("object-src"), ["'none'"]);
    assert.deepEqual(parsed.get("form-action"), ["'self'"]);
  });

  it("allows self and inline scripts in production", () => {
    const scriptSrc = directives(productionCsp()).get("script-src") ?? [];

    assert.ok(scriptSrc.includes("'self'"));
    assert.ok(scriptSrc.includes("'unsafe-inline'"));
  });

  it("keeps 'unsafe-eval' out of production and available in development", () => {
    assert.equal(
      (directives(productionCsp()).get("script-src") ?? []).includes("'unsafe-eval'"),
      false,
      "production App Router output does not evaluate generated code",
    );

    const devPolicy = headerValue(development(), "Content-Security-Policy-Report-Only") ?? "";

    assert.ok((directives(devPolicy).get("script-src") ?? []).includes("'unsafe-eval'"));
  });

  it("does not admit data: or blob: as script sources", () => {
    const scriptSrc = directives(productionCsp()).get("script-src") ?? [];

    assert.equal(scriptSrc.includes("data:"), false);
    assert.equal(scriptSrc.includes("blob:"), false);
  });

  it("supports the inline styles Tailwind and Next.js require", () => {
    const styleSrc = directives(productionCsp()).get("style-src") ?? [];

    assert.deepEqual(styleSrc, ["'self'", "'unsafe-inline'"]);
  });

  it("supports self, data:, blob: and the Supabase origin for images", () => {
    const imgSrc = directives(productionCsp()).get("img-src") ?? [];

    assert.ok(imgSrc.includes("'self'"));
    assert.ok(imgSrc.includes("data:"), "demo returns a base64 data: image");
    assert.ok(imgSrc.includes("blob:"), "uploader previews use blob object URLs");
    assert.ok(imgSrc.includes(SUPABASE_ORIGIN), "product and signed images load from Supabase");
  });

  it("serves fonts from self and data: without a Google Fonts origin", () => {
    const fontSrc = directives(productionCsp()).get("font-src") ?? [];

    // next/font/google self-hosts at build time, so no external font origin is contacted.
    assert.deepEqual(fontSrc, ["'self'", "data:"]);
    assert.doesNotMatch(productionCsp(), /gstatic|googleapis/);
  });

  it("connects only to self, Supabase and the configured PostHog host", () => {
    const connectSrc = directives(productionCsp()).get("connect-src") ?? [];

    assert.deepEqual(connectSrc, ["'self'", SUPABASE_ORIGIN, POSTHOG_HOST]);
  });

  it("adds local HMR websockets in development only", () => {
    const devPolicy = headerValue(development(), "Content-Security-Policy-Report-Only") ?? "";
    const devConnect = directives(devPolicy).get("connect-src") ?? [];

    assert.ok(devConnect.includes("ws://localhost:*"));
    assert.ok(devConnect.includes("ws://127.0.0.1:*"));

    const prodConnect = directives(productionCsp()).get("connect-src") ?? [];

    assert.equal(
      prodConnect.some((source) => source.startsWith("ws://")),
      false,
      "development tooling must not weaken the production policy",
    );
  });

  it("supports self and blob: workers", () => {
    const workerSrc = directives(productionCsp()).get("worker-src") ?? [];

    assert.deepEqual(workerSrc, ["'self'", "blob:"]);
  });

  it("omits server-side-only providers from the browser policy", () => {
    const policy = productionCsp();

    // OpenAI is called only from route handlers; Phase 8C.1 Sentry is server-only.
    assert.doesNotMatch(policy, /openai/i);
    assert.doesNotMatch(policy, /sentry|ingest\.sentry\.io/i);
    // No browser source calls Inngest directly.
    assert.doesNotMatch(policy, /inngest/i);
  });
});

describe("CSP cannot become permissive or leak configuration", () => {
  it("contains no wildcard source", () => {
    for (const [directive, sources] of directives(productionCsp())) {
      assert.equal(sources.includes("*"), false, `${directive} must not allow any origin`);
      assert.equal(sources.includes("https:"), false, `${directive} must not allow a bare scheme`);
      assert.equal(sources.includes("http:"), false, `${directive} must not allow a bare scheme`);
      assert.equal(
        sources.some((source) => source.startsWith("*.")),
        false,
        `${directive} must not use a wildcard host`,
      );
    }
  });

  it("reduces configured URLs to bare origins", () => {
    assert.equal(
      toCspOrigin("https://abcdefgh.supabase.co/storage/v1/object/public"),
      SUPABASE_ORIGIN,
    );
    assert.equal(toCspOrigin("https://us.i.posthog.com/"), POSTHOG_HOST);
    assert.equal(toCspOrigin("  https://abcdefgh.supabase.co  "), SUPABASE_ORIGIN);
    assert.equal(toCspOrigin("http://127.0.0.1:54321"), "http://127.0.0.1:54321");
  });

  it("never emits undefined, empty or malformed sources", () => {
    assert.equal(toCspOrigin(undefined), undefined);
    assert.equal(toCspOrigin(""), undefined);
    assert.equal(toCspOrigin("   "), undefined);
    assert.equal(toCspOrigin("not-a-url"), undefined);
    assert.equal(toCspOrigin("your-project.supabase.co"), undefined);
    assert.equal(toCspOrigin("javascript:alert(1)"), undefined);
    assert.equal(toCspOrigin("data:text/html,x"), undefined);

    const unconfigured = buildContentSecurityPolicy({ isProduction: true });

    assert.doesNotMatch(unconfigured, /undefined/);
    assert.doesNotMatch(unconfigured, /\s;/);
    assert.match(unconfigured, /connect-src 'self'/);
    assert.match(unconfigured, /img-src 'self' data: blob:/);
  });

  it("strips paths, queries and credentials that could carry a key or token", () => {
    const policy = buildContentSecurityPolicy({
      isProduction: true,
      supabaseUrl: "https://user:pa55word@abcdefgh.supabase.co/rest/v1?apikey=SUPER_SECRET",
      posthogHost: "https://us.i.posthog.com/e/?token=phc_SECRET_TOKEN",
    });

    for (const secret of [
      "SUPER_SECRET",
      "phc_SECRET_TOKEN",
      "apikey",
      "pa55word",
      "user:",
      "/rest/v1",
      "?",
    ]) {
      assert.equal(policy.includes(secret), false, `policy must not contain ${secret}`);
    }

    assert.ok(policy.includes(SUPABASE_ORIGIN));
    assert.ok(policy.includes(POSTHOG_HOST));
  });

  it("reads no server-only environment variable", () => {
    const headers = securityHeadersFromEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_POSTHOG_HOST: POSTHOG_HOST,
      SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      OPENAI_API_KEY: "sk-openai-secret",
      SENTRY_DSN: "https://publickey@o1.ingest.sentry.io/2",
      LEAD_RATE_LIMIT_HASH_SECRET: "hash-secret",
      UPSTASH_REDIS_REST_TOKEN: "upstash-secret",
      INNGEST_SIGNING_KEY: "signkey-secret",
    });
    const serialized = headers.map((header) => `${header.key}: ${header.value}`).join("\n");

    for (const secret of [
      "service-role-secret",
      "sk-openai-secret",
      "ingest.sentry.io",
      "hash-secret",
      "upstash-secret",
      "signkey-secret",
    ]) {
      assert.equal(serialized.includes(secret), false, `headers must not contain ${secret}`);
    }

    const source = readFileSync(HEADERS_MODULE, "utf8");
    const readVars = [...source.matchAll(/env\.([A-Z0-9_]+)/g)].map((match) => match[1]);

    for (const name of readVars) {
      assert.ok(
        name === "NODE_ENV" || name.startsWith("NEXT_PUBLIC_"),
        `only public configuration may be read, found ${name}`,
      );
    }
  });
});

describe("global headers still omit a blanket framing policy", () => {
  it("sets no X-Frame-Options header", () => {
    for (const headers of [production(), development()]) {
      assert.equal(headerValue(headers, "X-Frame-Options"), undefined);
    }
  });

  it("sets no frame-ancestors directive", () => {
    assert.equal(directives(productionCsp()).has("frame-ancestors"), false);
    assert.doesNotMatch(
      headerValue(development(), "Content-Security-Policy-Report-Only") ?? "",
      /frame-ancestors/,
    );
  });

  it("guards against a global restrictive framing rule being reintroduced", () => {
    // Path-specific framing lives in lib/embed/framing.ts and proxy.ts. A blanket
    // DENY here would block the merchant embed, and a blanket allow would frame the
    // dashboard. This global header set stays out of that decision.
    for (const file of [HEADERS_MODULE, NEXT_CONFIG]) {
      const source = readFileSync(file, "utf8");
      const active = source
        .split("\n")
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
        .join("\n");

      assert.doesNotMatch(active, /X-Frame-Options/i, `${file} must not set a framing header`);
      assert.doesNotMatch(active, /frame-ancestors/i, `${file} must not set frame-ancestors`);
      assert.doesNotMatch(active, /SAMEORIGIN|DENY/i, `${file} must not set a framing value`);
    }
  });
});

describe("cross-origin isolation headers are deferred", () => {
  it("sets no COOP, CORP or COEP header", () => {
    const deferred = [
      "Cross-Origin-Opener-Policy",
      "Cross-Origin-Resource-Policy",
      "Cross-Origin-Embedder-Policy",
    ];

    for (const headers of [production(), development()]) {
      for (const key of deferred) {
        assert.equal(headerValue(headers, key), undefined, `${key} is deferred`);
      }
    }

    const source = readFileSync(HEADERS_MODULE, "utf8");

    assert.doesNotMatch(source, /key: "Cross-Origin-/);
  });
});

describe("header wiring", () => {
  it("applies the header set to every route from next.config.mjs", () => {
    const config = readFileSync(NEXT_CONFIG, "utf8");

    assert.match(config, /import \{ securityHeadersFromEnv \} from "\.\/lib\/security\/headers\.mjs"/);
    assert.match(config, /async headers\(\)/);
    assert.match(config, /source: "\/:path\*", headers: securityHeadersFromEnv\(\)/);
  });

  it("emits exactly the expected header names", () => {
    assert.deepEqual(
      production().map((header) => header.key),
      [
        "X-Content-Type-Options",
        "Referrer-Policy",
        "Permissions-Policy",
        "Content-Security-Policy-Report-Only",
        "Strict-Transport-Security",
      ],
    );

    assert.deepEqual(
      development().map((header) => header.key),
      [
        "X-Content-Type-Options",
        "Referrer-Policy",
        "Permissions-Policy",
        "Content-Security-Policy-Report-Only",
      ],
    );
  });
});
