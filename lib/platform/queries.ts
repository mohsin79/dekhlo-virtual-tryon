import "server-only";

import { calculateAvailableCredits } from "@/lib/credits/balance";
import {
  formatAllowlistedAuditMetadata,
  formatAllowlistedTransactionMetadata,
  summarizeAllowlistedMetadata,
} from "@/lib/platform/audit-format";
import { PLATFORM_AUDIT_ACTIONS, PLATFORM_PAGE_SIZE } from "@/lib/platform/constants";
import { createAdminClient } from "@/lib/supabase/admin";

export type PlatformOverviewStats = {
  totalBrands: number;
  totalActiveProducts: number;
  completedTryOns: number;
  failedTryOns: number;
  grantedCredits: number;
  reservedCredits: number;
  consumedCredits: number;
  availableCredits: number;
};

export type PlatformRecentAuditRow = {
  id: string;
  action: string;
  createdAt: string;
  reason: string;
  brandName: string | null;
  actorName: string;
};

export async function fetchPlatformOverview(): Promise<{
  stats: PlatformOverviewStats;
  recentAudit: PlatformRecentAuditRow[];
}> {
  const admin = createAdminClient();

  const [
    brandsCount,
    productsCount,
    completedTryOns,
    failedTryOns,
    balances,
    recentAudit,
  ] = await Promise.all([
    admin.from("brands").select("id", { count: "exact", head: true }),
    admin.from("products").select("id", { count: "exact", head: true }).eq("is_active", true),
    admin
      .from("try_on_sessions")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .is("deleted_at", null),
    admin
      .from("try_on_sessions")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .is("deleted_at", null),
    admin
      .from("brand_credit_balances")
      .select("granted_credits, reserved_credits, consumed_credits"),
    admin
      .from("audit_logs")
      .select("id, action, created_at, reason, brand_id, actor_user_id")
      .in("action", [...PLATFORM_AUDIT_ACTIONS])
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  if (brandsCount.error) throw brandsCount.error;
  if (productsCount.error) throw productsCount.error;
  if (completedTryOns.error) throw completedTryOns.error;
  if (failedTryOns.error) throw failedTryOns.error;
  if (balances.error) throw balances.error;
  if (recentAudit.error) throw recentAudit.error;

  let grantedCredits = 0;
  let reservedCredits = 0;
  let consumedCredits = 0;

  for (const row of balances.data ?? []) {
    grantedCredits += row.granted_credits;
    reservedCredits += row.reserved_credits;
    consumedCredits += row.consumed_credits;
  }

  const brandIds = [...new Set((recentAudit.data ?? []).map((row) => row.brand_id).filter(Boolean))];
  const actorIds = [...new Set((recentAudit.data ?? []).map((row) => row.actor_user_id))];

  const [brandsById, actorsById] = await Promise.all([
    brandIds.length > 0
      ? admin.from("brands").select("id, name").in("id", brandIds as string[])
      : Promise.resolve({ data: [], error: null }),
    actorIds.length > 0
      ? admin.from("profiles").select("id, full_name").in("id", actorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (brandsById.error) throw brandsById.error;
  if (actorsById.error) throw actorsById.error;

  const brandNameMap = new Map((brandsById.data ?? []).map((b) => [b.id, b.name]));
  const actorNameMap = new Map(
    (actorsById.data ?? []).map((p) => [p.id, p.full_name?.trim() || "Platform admin"]),
  );

  return {
    stats: {
      totalBrands: brandsCount.count ?? 0,
      totalActiveProducts: productsCount.count ?? 0,
      completedTryOns: completedTryOns.count ?? 0,
      failedTryOns: failedTryOns.count ?? 0,
      grantedCredits,
      reservedCredits,
      consumedCredits,
      availableCredits: calculateAvailableCredits(
        grantedCredits,
        reservedCredits,
        consumedCredits,
      ),
    },
    recentAudit: (recentAudit.data ?? []).map((row) => ({
      id: row.id,
      action: row.action,
      createdAt: row.created_at,
      reason: row.reason,
      brandName: row.brand_id ? (brandNameMap.get(row.brand_id) ?? null) : null,
      actorName: actorNameMap.get(row.actor_user_id) ?? "Platform admin",
    })),
  };
}

export type PlatformBrandListItem = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  activeProductCount: number;
  grantedCredits: number;
  reservedCredits: number;
  consumedCredits: number;
  availableCredits: number;
};

export async function fetchPlatformBrandList(options: {
  page: number;
  search: string;
}): Promise<{ brands: PlatformBrandListItem[]; total: number; pageSize: number }> {
  const admin = createAdminClient();
  const from = (options.page - 1) * PLATFORM_PAGE_SIZE;
  const to = from + PLATFORM_PAGE_SIZE - 1;

  let query = admin
    .from("brands")
    .select("id, name, slug, created_at", { count: "exact" })
    .order("created_at", { ascending: false });

  if (options.search) {
    const escaped = options.search.replace(/[%_\\]/g, "\\$&");
    const pattern = `%${escaped}%`;
    query = query.or(`name.ilike.${pattern},slug.ilike.${pattern}`);
  }

  const { data: brands, error, count } = await query.range(from, to);

  if (error) {
    throw error;
  }

  const brandRows = brands ?? [];
  const brandIds = brandRows.map((brand) => brand.id);

  if (brandIds.length === 0) {
    return { brands: [], total: count ?? 0, pageSize: PLATFORM_PAGE_SIZE };
  }

  const [balances, productCounts] = await Promise.all([
    admin
      .from("brand_credit_balances")
      .select("brand_id, granted_credits, reserved_credits, consumed_credits")
      .in("brand_id", brandIds),
    admin.from("products").select("brand_id").in("brand_id", brandIds).eq("is_active", true),
  ]);

  if (balances.error) throw balances.error;
  if (productCounts.error) throw productCounts.error;

  const balanceMap = new Map(
    (balances.data ?? []).map((row) => [
      row.brand_id,
      {
        grantedCredits: row.granted_credits,
        reservedCredits: row.reserved_credits,
        consumedCredits: row.consumed_credits,
      },
    ]),
  );

  const productCountMap = new Map<string, number>();

  for (const product of productCounts.data ?? []) {
    productCountMap.set(product.brand_id, (productCountMap.get(product.brand_id) ?? 0) + 1);
  }

  return {
    brands: brandRows.map((brand) => {
      const balance = balanceMap.get(brand.id) ?? {
        grantedCredits: 0,
        reservedCredits: 0,
        consumedCredits: 0,
      };

      return {
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        createdAt: brand.created_at,
        activeProductCount: productCountMap.get(brand.id) ?? 0,
        grantedCredits: balance.grantedCredits,
        reservedCredits: balance.reservedCredits,
        consumedCredits: balance.consumedCredits,
        availableCredits: calculateAvailableCredits(
          balance.grantedCredits,
          balance.reservedCredits,
          balance.consumedCredits,
        ),
      };
    }),
    total: count ?? 0,
    pageSize: PLATFORM_PAGE_SIZE,
  };
}

export type PlatformBrandDetail = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  activeProductCount: number;
  completedTryOnCount: number;
  failedTryOnCount: number;
  grantedCredits: number;
  reservedCredits: number;
  consumedCredits: number;
  availableCredits: number;
  maxRevocableCredits: number;
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    createdAt: string;
    metadataSummary: string | null;
  }>;
  auditEntries: Array<{
    id: string;
    action: string;
    createdAt: string;
    reason: string;
    actorName: string;
    metadataSummary: string | null;
  }>;
};

export async function fetchPlatformBrandDetail(
  brandId: string,
): Promise<PlatformBrandDetail | null> {
  const admin = createAdminClient();

  const { data: brand, error: brandError } = await admin
    .from("brands")
    .select("id, name, slug, created_at")
    .eq("id", brandId)
    .maybeSingle();

  if (brandError) {
    throw brandError;
  }

  if (!brand) {
    return null;
  }

  const [
    balanceResult,
    productCount,
    completedCount,
    failedCount,
    transactions,
    auditEntries,
  ] = await Promise.all([
    admin
      .from("brand_credit_balances")
      .select("granted_credits, reserved_credits, consumed_credits")
      .eq("brand_id", brandId)
      .maybeSingle(),
    admin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("brand_id", brandId)
      .eq("is_active", true),
    admin
      .from("try_on_sessions")
      .select("id", { count: "exact", head: true })
      .eq("brand_id", brandId)
      .eq("status", "completed")
      .is("deleted_at", null),
    admin
      .from("try_on_sessions")
      .select("id", { count: "exact", head: true })
      .eq("brand_id", brandId)
      .eq("status", "failed")
      .is("deleted_at", null),
    admin
      .from("credit_transactions")
      .select("id, type, amount, created_at, metadata")
      .eq("brand_id", brandId)
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("audit_logs")
      .select("id, action, created_at, reason, actor_user_id, metadata")
      .eq("brand_id", brandId)
      .in("action", [...PLATFORM_AUDIT_ACTIONS])
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (balanceResult.error) throw balanceResult.error;
  if (productCount.error) throw productCount.error;
  if (completedCount.error) throw completedCount.error;
  if (failedCount.error) throw failedCount.error;
  if (transactions.error) throw transactions.error;
  if (auditEntries.error) throw auditEntries.error;

  const grantedCredits = balanceResult.data?.granted_credits ?? 0;
  const reservedCredits = balanceResult.data?.reserved_credits ?? 0;
  const consumedCredits = balanceResult.data?.consumed_credits ?? 0;
  const availableCredits = calculateAvailableCredits(
    grantedCredits,
    reservedCredits,
    consumedCredits,
  );

  const actorIds = [...new Set((auditEntries.data ?? []).map((row) => row.actor_user_id))];
  const actorsResult =
    actorIds.length > 0
      ? await admin.from("profiles").select("id, full_name").in("id", actorIds)
      : { data: [], error: null };

  if (actorsResult.error) throw actorsResult.error;

  const actorNameMap = new Map(
    (actorsResult.data ?? []).map((profile) => [
      profile.id,
      profile.full_name?.trim() || "Platform admin",
    ]),
  );

  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    createdAt: brand.created_at,
    activeProductCount: productCount.count ?? 0,
    completedTryOnCount: completedCount.count ?? 0,
    failedTryOnCount: failedCount.count ?? 0,
    grantedCredits,
    reservedCredits,
    consumedCredits,
    availableCredits,
    maxRevocableCredits: availableCredits,
    transactions: (transactions.data ?? []).map((row) => {
      return {
        id: row.id,
        type: row.type,
        amount: row.amount,
        createdAt: row.created_at,
        metadataSummary: summarizeAllowlistedMetadata(
          formatAllowlistedTransactionMetadata(row.metadata) as Record<
            string,
            string | number | boolean
          >,
        ),
      };
    }),
    auditEntries: (auditEntries.data ?? []).map((row) => ({
      id: row.id,
      action: row.action,
      createdAt: row.created_at,
      reason: row.reason,
      actorName: actorNameMap.get(row.actor_user_id) ?? "Platform admin",
      metadataSummary: summarizeAllowlistedMetadata(formatAllowlistedAuditMetadata(row.metadata)),
    })),
  };
}

export type PlatformAuditListItem = {
  id: string;
  action: string;
  createdAt: string;
  reason: string;
  brandName: string | null;
  actorName: string;
  targetType: string | null;
  targetId: string | null;
  metadataSummary: string | null;
};

export async function fetchPlatformAuditList(options: {
  page: number;
  action: string;
  brandId: string;
}): Promise<{ entries: PlatformAuditListItem[]; total: number; pageSize: number }> {
  const admin = createAdminClient();
  const from = (options.page - 1) * PLATFORM_PAGE_SIZE;
  const to = from + PLATFORM_PAGE_SIZE - 1;

  let query = admin
    .from("audit_logs")
    .select(
      "id, action, created_at, reason, brand_id, actor_user_id, target_type, target_id, metadata",
      { count: "exact" },
    )
    .in("action", [...PLATFORM_AUDIT_ACTIONS])
    .order("created_at", { ascending: false });

  if (options.action) {
    query = query.eq("action", options.action);
  }

  if (options.brandId) {
    query = query.eq("brand_id", options.brandId);
  }

  const { data, error, count } = await query.range(from, to);

  if (error) {
    throw error;
  }

  const rows = data ?? [];
  const brandIds = [...new Set(rows.map((row) => row.brand_id).filter(Boolean))] as string[];
  const actorIds = [...new Set(rows.map((row) => row.actor_user_id))];

  const [brandsResult, actorsResult] = await Promise.all([
    brandIds.length > 0
      ? admin.from("brands").select("id, name").in("id", brandIds)
      : Promise.resolve({ data: [], error: null }),
    actorIds.length > 0
      ? admin.from("profiles").select("id, full_name").in("id", actorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (brandsResult.error) throw brandsResult.error;
  if (actorsResult.error) throw actorsResult.error;

  const brandNameMap = new Map((brandsResult.data ?? []).map((brand) => [brand.id, brand.name]));
  const actorNameMap = new Map(
    (actorsResult.data ?? []).map((profile) => [
      profile.id,
      profile.full_name?.trim() || "Platform admin",
    ]),
  );

  return {
    entries: rows.map((row) => ({
      id: row.id,
      action: row.action,
      createdAt: row.created_at,
      reason: row.reason,
      brandName: row.brand_id ? (brandNameMap.get(row.brand_id) ?? null) : null,
      actorName: actorNameMap.get(row.actor_user_id) ?? "Platform admin",
      targetType: row.target_type,
      targetId: row.target_id,
      metadataSummary: summarizeAllowlistedMetadata(formatAllowlistedAuditMetadata(row.metadata)),
    })),
    total: count ?? 0,
    pageSize: PLATFORM_PAGE_SIZE,
  };
}

export async function fetchPlatformBrandOptions(): Promise<Array<{ id: string; name: string }>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("brands")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}
