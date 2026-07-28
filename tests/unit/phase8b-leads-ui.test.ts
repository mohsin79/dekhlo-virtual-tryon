import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { LEAD_FORM_DISMISS_PREFIX } from "@/lib/leads/constants";
import { buildLeadMailtoLink, buildLeadTelLink } from "@/lib/leads/contact-links";
import { leadFormDismissStorageKey } from "@/lib/leads/dismiss-storage";
import {
  escapeLeadSearchPattern,
  leadsDateRangeToIsoBounds,
  parseLeadsDashboardFilters,
  parseLeadsPageParam,
  parseLeadsProductIdParam,
  parseLeadsSearchParam,
} from "@/lib/leads/dashboard-params";
import {
  assertExactResponseKeys,
  buildLeadGetResponse,
  LEAD_GET_RESPONSE_KEYS,
} from "@/lib/leads/public-response";
import { extractLeadProductLabel, parseLeadMetadata } from "@/lib/leads/snapshot-labels";

describe("lead dashboard params", () => {
  it("caps page number at 500", () => {
    assert.equal(parseLeadsPageParam("9999"), 500);
  });

  it("trims and caps search length", () => {
    assert.equal(parseLeadsSearchParam(`  ${"a".repeat(120)}  `).length, 100);
  });

  it("removes commas from search", () => {
    assert.equal(parseLeadsSearchParam("a,b"), "a b");
  });

  it("escapes ilike wildcards", () => {
    assert.equal(escapeLeadSearchPattern("100%_test"), "100\\%\\_test");
  });

  it("rejects invalid product UUID", () => {
    assert.equal(parseLeadsProductIdParam("not-uuid"), null);
  });

  it("rejects date ranges wider than 366 days", () => {
    const filters = parseLeadsDashboardFilters({
      start: "2024-01-01",
      end: "2026-07-01",
    });

    assert.equal(filters.startDate, "2024-01-01");
    assert.equal(filters.endDate, null);
  });

  it("maps inclusive date bounds to UTC timestamps", () => {
    const bounds = leadsDateRangeToIsoBounds({
      page: 1,
      search: "",
      productId: null,
      startDate: "2026-07-01",
      endDate: "2026-07-02",
    });

    assert.equal(bounds.startIso, "2026-07-01T00:00:00.000Z");
    assert.equal(bounds.endIso, "2026-07-02T23:59:59.999Z");
  });
});

describe("lead snapshot labels", () => {
  it("prefers joined product name over metadata", () => {
    const label = extractLeadProductLabel({
      productName: "Live name",
      metadata: parseLeadMetadata({ product_name: "Snapshot" }),
    });

    assert.equal(label, "Live name");
  });

  it("falls back to metadata and omits unknown keys", () => {
    const metadata = parseLeadMetadata({
      product_name: "Old name",
      session_id: "hidden",
    });

    assert.equal(metadata?.product_name, "Old name");
    assert.equal("session_id" in (metadata ?? {}), false);
  });
});

describe("lead contact links", () => {
  it("builds mailto and tel links", () => {
    assert.equal(buildLeadMailtoLink("shopper@example.com"), "mailto:shopper%40example.com");
    assert.equal(buildLeadTelLink("+923001234567"), "tel:+923001234567");
  });
});

describe("public lead GET contract for UI", () => {
  it("GET response has only submitted", () => {
    const body = buildLeadGetResponse(true);
    assertExactResponseKeys(body, LEAD_GET_RESPONSE_KEYS);
    assert.equal("leadId" in body, false);
  });
});

describe("lead dismiss storage keys", () => {
  it("uses session-scoped non-PII keys", () => {
    const key = leadFormDismissStorageKey("550e8400-e29b-41d4-a716-446655440000");
    assert.match(key, new RegExp(`^${LEAD_FORM_DISMISS_PREFIX}`));
    assert.equal(key.includes("@"), false);
  });
});

describe("merchant leads dashboard boundaries", () => {
  it("uses authenticated server client for queries", () => {
    const source = readFileSync("lib/leads/queries.ts", "utf8");
    assert.match(source, /createClient/);
    assert.equal(source.includes("createAdminClient"), false);
    assert.match(source, /order\("created_at", \{ ascending: false \}\)/);
    assert.match(source, /order\("id", \{ ascending: false \}\)/);
  });

  it("checks canViewLeads before querying on the page", () => {
    const source = readFileSync("app/dashboard/leads/page.tsx", "utf8");
    assert.match(source, /canViewLeads/);
    assert.match(source, /fetchBrandLeads/);
    assert.equal(source.includes("idempotency"), false);
    assert.equal(source.includes("dangerouslySetInnerHTML"), false);
  });
});

describe("public lead form integration boundaries", () => {
  it("ProductTryOn renders lead form only after completion", () => {
    const source = readFileSync("components/ProductTryOn.tsx", "utf8");
    assert.match(source, /phase === "done"/);
    assert.match(source, /LeadCaptureForm/);
    assert.match(source, /readActiveTryOnSessionId/);
    assert.equal(source.includes("/demo"), false);
  });

  it("lead capture form does not call generation or credit APIs", () => {
    const source = readFileSync("components/leads/lead-capture-form.tsx", "utf8");
    assert.match(source, /\/api\/try-on\/sessions\//);
    assert.equal(source.includes("queue_try_on_session"), false);
    assert.equal(source.includes("/api/inngest"), false);
    assert.equal(source.includes("openai"), false);
  });
});
