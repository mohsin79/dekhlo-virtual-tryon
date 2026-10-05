import {
  EMBED_RESIZE_MAX_HEIGHT,
  EMBED_RESIZE_MESSAGE_TYPE,
  EMBED_RESIZE_MIN_HEIGHT,
} from "@/lib/embed/resize";
import { BRAND_SLUG_PATTERN } from "@/lib/validation/brand";
import { PRODUCT_SLUG_PATTERN } from "@/lib/validation/product";

/** Starting height. The frame grows to its content after the resize message. */
export const EMBED_IFRAME_HEIGHT = 960;

/**
 * Host listener for one iframe. It sets style.height and ignores every other
 * field, so a message cannot deliver a token or a photo to the store page.
 */
export function merchantEmbedHostResizeListener(frameExpression: string): string {
  return `window.addEventListener("message", function (event) {
    var target = ${frameExpression};
    if (!target || event.source !== target.contentWindow) {
      return;
    }
    var expected;
    try {
      expected = new URL(target.src, window.location.href).origin;
    } catch (error) {
      return;
    }
    if (event.origin !== expected) {
      return;
    }
    var data = event.data;
    if (!data || data.type !== "${EMBED_RESIZE_MESSAGE_TYPE}" || typeof data.height !== "number" || !isFinite(data.height)) {
      return;
    }
    if (Object.keys(data).length !== 2) {
      return;
    }
    var height = Math.ceil(data.height);
    if (height < ${EMBED_RESIZE_MIN_HEIGHT} || height > ${EMBED_RESIZE_MAX_HEIGHT}) {
      return;
    }
    target.style.height = height + "px";
  });`;
}

function isCatalogSlug(value: string, pattern: RegExp): boolean {
  return value.length > 0 && value.length <= 100 && pattern.test(value);
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Shopper document merchants frame on their own product page. */
export function buildMerchantEmbedPath(brandSlug: string, productSlug: string): string | null {
  if (!isCatalogSlug(brandSlug, BRAND_SLUG_PATTERN) || !isCatalogSlug(productSlug, PRODUCT_SLUG_PATTERN)) {
    return null;
  }

  return `/embed/${brandSlug}/${productSlug}`;
}

export function buildMerchantEmbedUrl(
  siteUrl: string,
  brandSlug: string,
  productSlug: string,
): string | null {
  const path = buildMerchantEmbedPath(brandSlug, productSlug);

  if (!path) {
    return null;
  }

  const base = siteUrl.trim().replace(/\/$/, "");

  if (!base) {
    return null;
  }

  return `${base}${path}`;
}

export function buildMerchantEmbedLoaderUrl(siteUrl: string): string | null {
  const base = siteUrl.trim().replace(/\/$/, "");

  if (!base) {
    return null;
  }

  return `${base}/embed/loader`;
}

/**
 * Canonical snippet. An iframe keeps the try-on on Dekhlo's origin, so the
 * store page does not receive the session token, the upload, or the result.
 * No `sandbox`: a sandboxed frame without a same origin cannot call the session API.
 */
export function buildMerchantEmbedSnippet(
  siteUrl: string,
  brandSlug: string,
  productSlug: string,
): string | null {
  const url = buildMerchantEmbedUrl(siteUrl, brandSlug, productSlug);

  if (!url) {
    return null;
  }

  const src = escapeHtmlAttribute(url);
  const listener = merchantEmbedHostResizeListener("frame");

  return `<iframe src="${src}" title="Virtual try-on" width="100%" height="${EMBED_IFRAME_HEIGHT}" style="border:0;display:block;width:100%;max-width:100%;" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>
<script>
(function () {
  var frame = document.currentScript && document.currentScript.previousElementSibling;
  if (!frame || String(frame.tagName).toUpperCase() !== "IFRAME") {
    return;
  }
  ${listener}
})();
</script>`;
}

/** Optional loader for stores that would rather paste a script tag than an iframe. */
export function buildMerchantEmbedScriptSnippet(
  siteUrl: string,
  brandSlug: string,
  productSlug: string,
): string | null {
  if (!buildMerchantEmbedPath(brandSlug, productSlug)) {
    return null;
  }

  const loaderUrl = buildMerchantEmbedLoaderUrl(siteUrl);

  if (!loaderUrl) {
    return null;
  }

  const src = escapeHtmlAttribute(loaderUrl);
  const brand = escapeHtmlAttribute(brandSlug);
  const product = escapeHtmlAttribute(productSlug);

  return `<script src="${src}" data-brand="${brand}" data-product="${product}" async></script>`;
}

export function parseEmbedPreviewSlugs(input: {
  brand?: string | null;
  product?: string | null;
}): { brandSlug: string; productSlug: string } | null {
  const brandSlug = input.brand?.trim() ?? "";
  const productSlug = input.product?.trim() ?? "";

  if (!buildMerchantEmbedPath(brandSlug, productSlug)) {
    return null;
  }

  return { brandSlug, productSlug };
}

/**
 * Host-page loader. It creates the embed iframe and applies height-only
 * resize messages. It does not read the store page or call the try-on API.
 */
export function merchantEmbedLoaderSource(): string {
  const listener = merchantEmbedHostResizeListener("iframe");

  return `(function () {
  var script = document.currentScript;
  if (!script || !script.src) {
    return;
  }

  var brand = script.getAttribute("data-brand") || "";
  var product = script.getAttribute("data-product") || "";
  var slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  if (!slug.test(brand) || !slug.test(product) || brand.length > 100 || product.length > 100) {
    return;
  }

  var origin;

  try {
    origin = new URL(script.src).origin;
  } catch (error) {
    return;
  }

  var iframe = document.createElement("iframe");
  iframe.src = origin + "/embed/" + brand + "/" + product;
  iframe.title = "Virtual try-on";
  iframe.width = "100%";
  iframe.height = "${EMBED_IFRAME_HEIGHT}";
  iframe.style.border = "0";
  iframe.style.display = "block";
  iframe.style.width = "100%";
  iframe.style.maxWidth = "100%";
  iframe.loading = "lazy";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  script.insertAdjacentElement("afterend", iframe);
  ${listener}
})();
`;
}
