import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { selectActiveBrandMembership } from "@/lib/auth/active-brand";
import { buildPublicTryOnPath, buildPublicTryOnUrl } from "@/lib/catalog/public-try-on-url";
import { formatCreditTransactionType } from "@/lib/credits/transaction-labels";
import { canStartProductTryOnGeneration } from "@/lib/try-on/sessions/product-try-on-flow";
import {
  shouldRedispatchQueuedGeneration,
} from "@/lib/try-on/sessions/redispatch-generation";

const BRAND_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const BRAND_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("public try-on links", () => {
  it("builds a shopper path from publishable slugs", () => {
    assert.equal(buildPublicTryOnPath("khaadi", "red-kurta"), "/try/khaadi/red-kurta");
  });

  it("rejects slugs that are not safe to publish", () => {
    assert.equal(buildPublicTryOnPath("../admin", "red-kurta"), null);
    assert.equal(buildPublicTryOnPath("khaadi", "Red Kurta"), null);
    assert.equal(buildPublicTryOnPath("", "red-kurta"), null);
  });

  it("builds an absolute URL without a trailing slash on the site origin", () => {
    assert.equal(
      buildPublicTryOnUrl("https://dekhlo.pk/", "khaadi", "red-kurta"),
      "https://dekhlo.pk/try/khaadi/red-kurta",
    );
  });
});

describe("active brand selection", () => {
  const memberships = [
    { brandId: BRAND_A, brand: { name: "Alpha" } },
    { brandId: BRAND_B, brand: { name: "Beta" } },
  ];

  it("uses the cookie when it matches a membership", () => {
    assert.equal(selectActiveBrandMembership(memberships, BRAND_B)?.brandId, BRAND_B);
  });

  it("falls back to the first membership for a missing or foreign brand id", () => {
    assert.equal(selectActiveBrandMembership(memberships, null)?.brandId, BRAND_A);
    assert.equal(selectActiveBrandMembership(memberships, "cccccccc-cccc-cccc-cccc-cccccccccccc")?.brandId, BRAND_A);
  });

  it("returns null when the user has no memberships", () => {
    assert.equal(selectActiveBrandMembership([], BRAND_A), null);
  });
});

describe("merchant credit labels", () => {
  it("describes try-on usage without raw admin enum names", () => {
    assert.equal(formatCreditTransactionType("reserve"), "Reserved for try-on");
    assert.equal(formatCreditTransactionType("consume"), "Used by try-on");
    assert.equal(formatCreditTransactionType("release"), "Released after try-on");
    assert.equal(formatCreditTransactionType("admin_grant"), "Added by Dekhlo");
    assert.equal(formatCreditTransactionType("admin_revoke"), "Removed by Dekhlo");
    assert.equal(formatCreditTransactionType("adjust"), "Credit update");
  });
});

describe("queued generation recovery", () => {
  it("redispatches only queued sessions", () => {
    assert.equal(shouldRedispatchQueuedGeneration("queued"), true);
    assert.equal(shouldRedispatchQueuedGeneration("processing"), false);
    assert.equal(shouldRedispatchQueuedGeneration("completed"), false);
    assert.equal(shouldRedispatchQueuedGeneration("failed"), false);
    assert.equal(shouldRedispatchQueuedGeneration(null), false);
  });

  it("does not start another try-on while a session is still in flight", () => {
    assert.equal(
      canStartProductTryOnGeneration({
        phase: "error",
        hasPersonFile: true,
        sessionStatus: "queued",
      }),
      false,
    );
    assert.equal(
      canStartProductTryOnGeneration({
        phase: "error",
        hasPersonFile: true,
        sessionStatus: "failed",
      }),
      true,
    );
  });

  it("fails the generate route when dispatch is not accepted", () => {
    const source = readFileSync("app/api/try-on/sessions/[sessionId]/generate/route.ts", "utf8");
    assert.match(source, /if \(!dispatched\.ok\)/);
    assert.match(source, /genericErrorResponse\([\s\S]*503/);
  });
});

describe("auth confirmation is not consumed by a GET", () => {
  it("renders a confirm button and does not verify the token while rendering", () => {
    const page = readFileSync("app/auth/confirm/page.tsx", "utf8");
    const action = readFileSync("app/auth/confirm/actions.ts", "utf8");

    assert.equal(page.includes("verifyOtp"), false);
    assert.equal(page.includes("exchangeCodeForSession"), false);
    assert.match(page, /ConfirmCallbackForm/);
    assert.match(action, /verifyOtp/);
    assert.match(action, /exchangeCodeForSession/);
    assert.equal(action.includes("token_hash: tokenHash"), true);
  });
});

describe("merchant launch copy", () => {
  it("no longer tells merchants that try-on arrives in a later phase", () => {
    const files = [
      "app/dashboard/page.tsx",
      "app/dashboard/credits/page.tsx",
      "components/products/product-form.tsx",
      "components/auth/onboarding-form.tsx",
    ];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.toLowerCase().includes("later phase"), false, file);
      assert.equal(source.includes("Phase 6"), false, file);
    }
  });

  it("shows the public try-on link on the product catalog", () => {
    const source = readFileSync("app/dashboard/products/page.tsx", "utf8");
    assert.match(source, /PublicTryOnLink/);
  });
});

describe("public crawl rules", () => {
  it("keeps merchant and admin routes out of the index", () => {
    const source = readFileSync("app/robots.ts", "utf8");
    for (const path of ["/dashboard", "/platform", "/onboarding", "/auth", "/api/"]) {
      assert.match(source, new RegExp(path.replace("/", "\\/")));
    }
  });
});
