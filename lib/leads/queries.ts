import "server-only";

import {
  escapeLeadSearchPattern,
  leadsDateRangeToIsoBounds,
  LEADS_PAGE_SIZE,
  type LeadsDashboardFilters,
} from "@/lib/leads/dashboard-params";
import { extractLeadProductLabel, parseLeadMetadata } from "@/lib/leads/snapshot-labels";
import { createClient } from "@/lib/supabase/server";

export type DashboardLeadRow = {
  id: string;
  createdAt: string;
  fullName: string | null;
  email: string;
  phone: string | null;
  productLabel: string;
  consentToContact: boolean;
  consentToMarketing: boolean;
  source: string;
};

export type LeadsQueryResult = {
  rows: DashboardLeadRow[];
  totalCount: number;
  page: number;
  pageSize: number;
};

export type LeadProductFilterOption = {
  id: string;
  label: string;
};

function buildSearchOrFilter(search: string): string | null {
  const trimmed = search.trim();

  if (!trimmed) {
    return null;
  }

  const escaped = escapeLeadSearchPattern(trimmed);
  const pattern = `%${escaped}%`;

  return `email.ilike.${pattern},full_name.ilike.${pattern},phone.ilike.${pattern}`;
}

export async function fetchLeadProductFilterOptions(brandId: string): Promise<LeadProductFilterOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, slug, is_active")
    .eq("brand_id", brandId)
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((product) => ({
    id: product.id,
    label: product.is_active ? product.name : `${product.name} (archived)`,
  }));
}

export async function fetchBrandLeads(
  brandId: string,
  filters: LeadsDashboardFilters,
): Promise<LeadsQueryResult> {
  const supabase = await createClient();
  const page = filters.page;
  const from = (page - 1) * LEADS_PAGE_SIZE;
  const to = from + LEADS_PAGE_SIZE - 1;
  const { startIso, endIso } = leadsDateRangeToIsoBounds(filters);

  let query = supabase
    .from("leads")
    .select(
      "id, created_at, full_name, email, phone, product_id, consent_to_contact, consent_to_marketing, source, metadata",
      { count: "exact" },
    )
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);

  if (filters.productId) {
    query = query.eq("product_id", filters.productId);
  }

  if (startIso) {
    query = query.gte("created_at", startIso);
  }

  if (endIso) {
    query = query.lte("created_at", endIso);
  }

  const searchFilter = buildSearchOrFilter(filters.search);

  if (searchFilter) {
    query = query.or(searchFilter);
  }

  const { data, error, count } = await query;

  if (error) {
    throw error;
  }

  const productIds = [...new Set((data ?? []).map((row) => row.product_id))];
  const productNameById = new Map<string, string | null>();

  if (productIds.length > 0) {
    const { data: products } = await supabase
      .from("products")
      .select("id, name")
      .eq("brand_id", brandId)
      .in("id", productIds);

    for (const product of products ?? []) {
      productNameById.set(product.id, product.name);
    }
  }

  const rows: DashboardLeadRow[] = (data ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    productLabel: extractLeadProductLabel({
      productName: productNameById.get(row.product_id) ?? null,
      metadata: parseLeadMetadata(row.metadata),
    }),
    consentToContact: row.consent_to_contact,
    consentToMarketing: row.consent_to_marketing,
    source: row.source,
  }));

  return {
    rows,
    totalCount: count ?? 0,
    page,
    pageSize: LEADS_PAGE_SIZE,
  };
}
