import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  EMBED_IFRAME_HEIGHT,
  buildMerchantEmbedPath,
  buildMerchantEmbedScriptSnippet,
  buildMerchantEmbedSnippet,
  buildMerchantEmbedUrl,
  merchantEmbedLoaderSource,
  parseEmbedPreviewSlugs,
} from "@/lib/catalog/merchant-embed";
import { framingHeadersForPath } from "@/lib/embed/framing";
import {
  buildSessionAuthHeaders,
  buildTryOnSessionCreateHeaders,
  isSessionAccessTokenShape,
  readEmbedRevealedToken,
  selectPresentedSessionToken,
  shouldRetryEmbedSessionCreate,
  shouldRevealSessionAccessToken,
} from "@/lib/embed/session-presentation";
import {
  clearEmbedSessionCredential,
  embedSessionStorageKey,
  readEmbedSessionCredential,
  writeEmbedSessionCredential,
} from "@/lib/try-on/sessions/embed-session-storage";
import { generateSessionAccessToken } from "@/lib/try-on/sessions/token-crypto";

const BRAND = "dekhlo-test-brand";
const PRODUCT = "test-black-t-shirt";
const SITE = "https://dekhlo.example";
const TOKEN = generateSessionAccessToken().token;
const SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";

function headerValue(headers: { key: string; value: string }[], key: string): string | undefined {
  return headers.find((header) => header.key === key)?.value;
}

function memoryStorage() {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe("merchant embed snippet", () => {
  it("builds an embed path and absolute URL from publishable slugs", () => {
    assert.equal(buildMerchantEmbedPath(BRAND, PRODUCT), `/embed/${BRAND}/${PRODUCT}`);
    assert.equal(
      buildMerchantEmbedUrl(`${SITE}/`, BRAND, PRODUCT),
      `${SITE}/embed/${BRAND}/${PRODUCT}`,
    );
  });

  it("rejects slugs that are not safe to publish", () => {
    assert.equal(buildMerchantEmbedPath("../admin", PRODUCT), null);
    assert.equal(buildMerchantEmbedPath(BRAND, "Red Shirt"), null);
    assert.equal(buildMerchantEmbedPath("", PRODUCT), null);
    assert.equal(buildMerchantEmbedSnippet(SITE, BRAND, "Red Shirt"), null);
    assert.equal(buildMerchantEmbedScriptSnippet(SITE, "<script>", PRODUCT), null);
    assert.equal(parseEmbedPreviewSlugs({ brand: "../admin", product: PRODUCT }), null);
  });

  it("returns an iframe snippet that stays on the Dekhlo embed document", () => {
    const snippet = buildMerchantEmbedSnippet(SITE, BRAND, PRODUCT);

    assert.ok(snippet);
    assert.match(snippet ?? "", new RegExp(`src="${SITE}/embed/${BRAND}/${PRODUCT}"`));
    assert.match(snippet ?? "", /title="Virtual try-on"/);
    assert.match(snippet ?? "", new RegExp(`height="${EMBED_IFRAME_HEIGHT}"`));
    assert.match(snippet ?? "", /referrerpolicy="strict-origin-when-cross-origin"/);
    assert.doesNotMatch(snippet ?? "", /sandbox/i);
    assert.doesNotMatch(snippet ?? "", /allow=/i);
    assert.doesNotMatch(snippet ?? "", /sessionAccessToken|service_role|SUPABASE_SECRET|OPENAI/i);
  });

  it("returns a loader script tag that only names the brand and product", () => {
    const snippet = buildMerchantEmbedScriptSnippet(SITE, BRAND, PRODUCT);

    assert.equal(
      snippet,
      `<script src="${SITE}/embed/loader" data-brand="${BRAND}" data-product="${PRODUCT}" async></script>`,
    );
  });
});

describe("embed loader script", () => {
  const source = merchantEmbedLoaderSource();

  it("mounts an iframe and does not touch the host page's data", () => {
    assert.match(source, /\/embed\/" \+ brand \+ "\/" \+ product/);
    assert.match(source, /data-brand/);
    assert.match(source, /data-product/);
    assert.doesNotMatch(source, /postMessage|document\.cookie|localStorage|sessionStorage|fetch\(|XMLHttpRequest/);
    assert.doesNotMatch(source, /sessionAccessToken|service_role|OPENAI/i);
  });

  it("is the body served by the loader route", () => {
    const route = readFileSync("app/embed/loader/route.ts", "utf8");

    assert.match(route, /merchantEmbedLoaderSource/);
    assert.match(route, /application\/javascript/);
  });
});

describe("embed session credential", () => {
  it("accepts generated session tokens and rejects other header shapes", () => {
    assert.equal(isSessionAccessTokenShape(TOKEN), true);
    assert.equal(isSessionAccessTokenShape("short"), false);
    assert.equal(isSessionAccessTokenShape(`${TOKEN}extra`), false);
    assert.equal(isSessionAccessTokenShape(`${TOKEN.slice(0, 42)}.`), false);
  });

  it("prefers the httpOnly cookie and uses a header only when the cookie is absent", () => {
    assert.equal(
      selectPresentedSessionToken({ cookieToken: "cookie-token", headerToken: TOKEN }),
      "cookie-token",
    );
    assert.equal(
      selectPresentedSessionToken({ cookieToken: null, headerToken: TOKEN }),
      TOKEN,
    );
    assert.equal(
      selectPresentedSessionToken({ cookieToken: "  ", headerToken: "not-a-token" }),
      null,
    );
    assert.equal(
      selectPresentedSessionToken({ cookieToken: null, headerToken: "not-a-token" }),
      null,
    );
  });

  it("keeps standalone session cookies httpOnly and SameSite=Lax", () => {
    const source = readFileSync("lib/try-on/sessions/tokens.ts", "utf8");

    assert.match(source, /httpOnly: true/);
    assert.match(source, /sameSite: "lax"/);
    assert.match(source, /readPresentedSessionAccessToken/);
  });

  it("adds no embed headers on the standalone try-on page", () => {
    assert.deepEqual(buildTryOnSessionCreateHeaders({ embed: false, sessionAccessToken: TOKEN }), {
      "Content-Type": "application/json",
    });
    assert.deepEqual(buildSessionAuthHeaders(null), {});
    assert.deepEqual(buildSessionAuthHeaders("not-a-token"), {});
  });

  it("sends the embed marker and a well-shaped token from the embed document", () => {
    const headers = buildTryOnSessionCreateHeaders({ embed: true, sessionAccessToken: TOKEN });

    assert.equal(headers["x-dekhlo-embed"], "1");
    assert.equal(headers["x-dekhlo-session-token"], TOKEN);
    assert.deepEqual(buildSessionAuthHeaders(TOKEN), { "x-dekhlo-session-token": TOKEN });
  });

  it("reads a revealed token only when it has the session token shape", () => {
    assert.equal(readEmbedRevealedToken({ sessionAccessToken: TOKEN }), TOKEN);
    assert.equal(readEmbedRevealedToken({ sessionAccessToken: "upload-token" }), null);
    assert.equal(readEmbedRevealedToken(null), null);
  });

  it("retries embed session create once when the previous create cannot be replayed", () => {
    assert.equal(shouldRetryEmbedSessionCreate(409), true);
    assert.equal(shouldRetryEmbedSessionCreate(201), false);
    assert.equal(shouldRetryEmbedSessionCreate(401), false);
  });

  it("stores the embed token in the frame's session storage, not a photo or result URL", () => {
    const storage = memoryStorage();

    writeEmbedSessionCredential(BRAND, PRODUCT, { sessionId: SESSION_ID, token: TOKEN }, storage);

    assert.deepEqual(readEmbedSessionCredential(BRAND, PRODUCT, storage), {
      sessionId: SESSION_ID,
      token: TOKEN,
    });
    assert.equal(
      storage.getItem(embedSessionStorageKey(BRAND, PRODUCT)),
      JSON.stringify({ sessionId: SESSION_ID, token: TOKEN }),
    );
    const stored = JSON.parse(storage.getItem(embedSessionStorageKey(BRAND, PRODUCT)) ?? "{}") as Record<
      string,
      unknown
    >;
    assert.deepEqual(Object.keys(stored).sort(), ["sessionId", "token"]);

    clearEmbedSessionCredential(BRAND, PRODUCT, storage);
    assert.equal(readEmbedSessionCredential(BRAND, PRODUCT, storage), null);
  });

  it("drops a stored credential that is not a session id plus token", () => {
    const storage = memoryStorage();
    storage.setItem(
      embedSessionStorageKey(BRAND, PRODUCT),
      JSON.stringify({ sessionId: SESSION_ID, token: TOKEN, resultUrl: "https://secret.example/photo" }),
    );

    const credential = readEmbedSessionCredential(BRAND, PRODUCT, storage);

    assert.deepEqual(credential, { sessionId: SESSION_ID, token: TOKEN });
    assert.equal("resultUrl" in (credential ?? {}), false);

    storage.setItem(embedSessionStorageKey(BRAND, PRODUCT), JSON.stringify({ sessionId: "nope", token: TOKEN }));
    assert.equal(readEmbedSessionCredential(BRAND, PRODUCT, storage), null);
  });
});

describe("embed token reveal", () => {
  const host = "dekhlo.example";
  const referer = `https://${host}/embed/${BRAND}/${PRODUCT}`;

  it("reveals the token only for a same-host embed document that asked for embed mode", () => {
    assert.equal(
      shouldRevealSessionAccessToken({ referer, host, embedRequested: true }),
      true,
    );
  });

  it("does not reveal the token for the standalone try-on page, the preview, or a foreign host", () => {
    assert.equal(
      shouldRevealSessionAccessToken({
        referer: `https://${host}/try/${BRAND}/${PRODUCT}`,
        host,
        embedRequested: true,
      }),
      false,
    );
    assert.equal(
      shouldRevealSessionAccessToken({
        referer: `https://${host}/embed/preview?brand=${BRAND}&product=${PRODUCT}`,
        host,
        embedRequested: true,
      }),
      false,
    );
    assert.equal(
      shouldRevealSessionAccessToken({
        referer: `https://shop.example/embed/${BRAND}/${PRODUCT}`,
        host,
        embedRequested: true,
      }),
      false,
    );
    assert.equal(
      shouldRevealSessionAccessToken({ referer, host, embedRequested: false }),
      false,
    );
    assert.equal(
      shouldRevealSessionAccessToken({ referer: `https://${host}`, host, embedRequested: true }),
      false,
    );
    assert.equal(
      shouldRevealSessionAccessToken({
        referer: `https://${host}/embed/${BRAND}/${PRODUCT}/../../dashboard`,
        host,
        embedRequested: true,
      }),
      false,
    );
  });
});

describe("embed framing", () => {
  it("allows merchant sites to frame only the embed document", () => {
    const headers = framingHeadersForPath(`/embed/${BRAND}/${PRODUCT}`);

    assert.equal(headerValue(headers, "Content-Security-Policy"), "frame-ancestors *");
    assert.equal(headerValue(headers, "X-Frame-Options"), undefined);
  });

  it("denies framing for the dashboard, standalone try-on, preview, and loader", () => {
    for (const path of [
      "/dashboard",
      "/dashboard/products",
      `/try/${BRAND}/${PRODUCT}`,
      "/embed/preview",
      "/embed/loader",
      "/auth/login",
      "/",
    ]) {
      const headers = framingHeadersForPath(path);

      assert.equal(headerValue(headers, "X-Frame-Options"), "DENY", path);
      assert.equal(headerValue(headers, "Content-Security-Policy"), "frame-ancestors 'none'", path);
    }
  });

  it("applies that policy from the request proxy", () => {
    const source = readFileSync("proxy.ts", "utf8");

    assert.match(source, /framingHeadersForPath/);
    assert.match(source, /withFraming\(/);
  });
});

describe("embed surfaces", () => {
  it("uses embed mode only on the embed document", () => {
    const embedPage = readFileSync("app/embed/[brandSlug]/[productSlug]/page.tsx", "utf8");
    const tryPage = readFileSync("app/try/[brandSlug]/[productSlug]/page.tsx", "utf8");
    const preview = readFileSync("app/embed/preview/page.tsx", "utf8");

    assert.match(embedPage, /variant="embed"/);
    assert.doesNotMatch(tryPage, /variant="embed"/);
    assert.doesNotMatch(preview, /sessionStorage|contentDocument|contentWindow|postMessage/);
    assert.match(preview, /\/embed\/preview\?brand=/);
  });

  it("passes the request into session authorization so an embed header can be read", () => {
    const files = [
      "app/api/try-on/sessions/[sessionId]/route.ts",
      "app/api/try-on/sessions/[sessionId]/validate-upload/route.ts",
      "app/api/try-on/sessions/[sessionId]/generate/route.ts",
    ];

    for (const file of files) {
      assert.match(readFileSync(file, "utf8"), /authorizeSessionAccess\(sessionId, request\)/);
    }

    assert.match(
      readFileSync("app/api/try-on/sessions/route.ts", "utf8"),
      /readPresentedSessionAccessToken\(sessionId, request\)/,
    );
    assert.match(
      readFileSync("lib/leads/handle-lead-capture.ts", "utf8"),
      /authorizeTryOnSessionForLead\(sessionIdParsed\.data, request\)/,
    );
  });

  it("shows the snippet beside the public try-on link", () => {
    const products = readFileSync("app/dashboard/products/page.tsx", "utf8");

    assert.match(products, /MerchantEmbedSnippet/);
    assert.match(products, /PublicTryOnLink/);
  });
});
