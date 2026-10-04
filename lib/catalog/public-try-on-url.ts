import { BRAND_SLUG_PATTERN } from "@/lib/validation/brand";
import { PRODUCT_SLUG_PATTERN } from "@/lib/validation/product";

function isCatalogSlug(value: string, pattern: RegExp): boolean {
  return value.length > 0 && value.length <= 100 && pattern.test(value);
}

/** Public shopper path for one active catalog product. Null when a slug is not publishable. */
export function buildPublicTryOnPath(brandSlug: string, productSlug: string): string | null {
  if (!isCatalogSlug(brandSlug, BRAND_SLUG_PATTERN) || !isCatalogSlug(productSlug, PRODUCT_SLUG_PATTERN)) {
    return null;
  }

  return `/try/${brandSlug}/${productSlug}`;
}

/** Absolute try-on URL merchants can paste into their store, WhatsApp, or Instagram. */
export function buildPublicTryOnUrl(
  siteUrl: string,
  brandSlug: string,
  productSlug: string,
): string | null {
  const path = buildPublicTryOnPath(brandSlug, productSlug);

  if (!path) {
    return null;
  }

  const base = siteUrl.trim().replace(/\/$/, "");

  if (!base) {
    return null;
  }

  return `${base}${path}`;
}
