import "server-only";

import {
  LEAD_METADATA_MAX_NAME_LENGTH,
  LEAD_METADATA_MAX_SLUG_LENGTH,
} from "@/lib/leads/constants";
import { createAdminClient } from "@/lib/supabase/admin";

export type LeadSnapshotMetadata = {
  brand_name: string;
  brand_slug: string;
  product_name: string;
  product_slug: string;
};

function truncate(value: string, max: number): string {
  return value.trim().slice(0, max);
}

export async function buildLeadSnapshotMetadata(
  brandId: string,
  productId: string,
): Promise<{ ok: true; metadata: LeadSnapshotMetadata } | { ok: false }> {
  const supabase = createAdminClient();

  const { data: productRow, error: productError } = await supabase
    .from("products")
    .select("name, slug, brand_id, brands ( name, slug )")
    .eq("id", productId)
    .eq("brand_id", brandId)
    .maybeSingle();

  if (productError || !productRow) {
    return { ok: false };
  }

  const brand = productRow.brands;

  if (!brand || Array.isArray(brand)) {
    return { ok: false };
  }

  return {
    ok: true,
    metadata: {
      brand_name: truncate(brand.name, LEAD_METADATA_MAX_NAME_LENGTH),
      brand_slug: truncate(brand.slug, LEAD_METADATA_MAX_SLUG_LENGTH),
      product_name: truncate(productRow.name, LEAD_METADATA_MAX_NAME_LENGTH),
      product_slug: truncate(productRow.slug, LEAD_METADATA_MAX_SLUG_LENGTH),
    },
  };
}
