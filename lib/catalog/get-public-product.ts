import "server-only";

import { createClient } from "@/lib/supabase/server";

export type PublicCatalogProduct = {
  productId: string;
  productName: string;
  productSlug: string;
  productImagePath: string;
  category: string | null;
  brandId: string;
  brandName: string;
  brandSlug: string;
  logoPath: string | null;
  widgetConfig: Record<string, unknown>;
};

export async function getPublicProductBySlugs(
  brandSlug: string,
  productSlug: string,
): Promise<PublicCatalogProduct | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_product_by_slugs", {
    p_brand_slug: brandSlug,
    p_product_slug: productSlug,
  });

  if (error || !data) {
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    return null;
  }

  return {
    productId: row.product_id,
    productName: row.product_name,
    productSlug: row.product_slug,
    productImagePath: row.product_image_path,
    category: row.category,
    brandId: row.brand_id,
    brandName: row.brand_name,
    brandSlug: row.brand_slug,
    logoPath: row.logo_path,
    widgetConfig: (row.widget_config as Record<string, unknown> | null) ?? {},
  };
}
