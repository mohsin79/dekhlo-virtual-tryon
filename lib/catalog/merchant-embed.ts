import { BRAND_SLUG_PATTERN } from "@/lib/validation/brand";
import { PRODUCT_SLUG_PATTERN } from "@/lib/validation/product";

/** Tall enough for the photo picker, consent, and result without a host-page script. */
export const EMBED_IFRAME_HEIGHT = 960;

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

  return `<iframe src="${src}" title="Virtual try-on" width="100%" height="${EMBED_IFRAME_HEIGHT}" style="border:0;max-width:100%;" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
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
 * Host-page loader. It creates the same iframe as the canonical snippet and
 * does not read the store page, call the try-on API, or listen for messages.
 */
export function merchantEmbedLoaderSource(): string {
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
  iframe.style.maxWidth = "100%";
  iframe.loading = "lazy";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  script.insertAdjacentElement("afterend", iframe);
})();
`;
}
