export type LeadSnapshotMetadata = {
  brand_name?: unknown;
  brand_slug?: unknown;
  product_name?: unknown;
  product_slug?: unknown;
};

export function extractLeadProductLabel(input: {
  productName: string | null;
  metadata: LeadSnapshotMetadata | null;
}): string {
  if (input.productName?.trim()) {
    return input.productName.trim();
  }

  const snapshotName = input.metadata?.product_name;

  if (typeof snapshotName === "string" && snapshotName.trim()) {
    return snapshotName.trim();
  }

  const snapshotSlug = input.metadata?.product_slug;

  if (typeof snapshotSlug === "string" && snapshotSlug.trim()) {
    return snapshotSlug.trim();
  }

  return "Product unavailable";
}

export function parseLeadMetadata(value: unknown): LeadSnapshotMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const allowed: LeadSnapshotMetadata = {};

  if (typeof record.brand_name === "string") allowed.brand_name = record.brand_name;
  if (typeof record.brand_slug === "string") allowed.brand_slug = record.brand_slug;
  if (typeof record.product_name === "string") allowed.product_name = record.product_name;
  if (typeof record.product_slug === "string") allowed.product_slug = record.product_slug;

  return allowed;
}
