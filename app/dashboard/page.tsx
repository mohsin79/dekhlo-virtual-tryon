import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserContext } from "@/lib/auth/get-user-context";
import { toCreditBalanceSnapshot } from "@/lib/credits/balance";
import { canViewCredits } from "@/lib/credits/permissions";
import { createClient } from "@/lib/supabase/server";

function formatRole(role: string | null): string {
  if (!role) {
    return "Member";
  }

  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default async function DashboardPage() {
  const context = await requireUserContext("/dashboard");
  const brand = context.currentBrand?.brand;

  if (!brand || !context.currentBrand) {
    return null;
  }

  const supabase = await createClient();
  const brandId = context.currentBrand.brandId;
  const displayName = context.profile.full_name?.trim() || "there";

  const productCountQuery = supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brandId);
  const activeProductQuery = supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brandId)
    .eq("is_active", true);

  const [{ count: productCount, error: productError }, { count: activeProductCount, error: activeError }] =
    await Promise.all([productCountQuery, activeProductQuery]);

  if (productError) {
    throw productError;
  }

  if (activeError) {
    throw activeError;
  }

  let availableCredits: number | null = null;

  if (canViewCredits(context.currentRole)) {
    const { data: balanceRow, error: balanceError } = await supabase
      .from("brand_credit_balances")
      .select("brand_id, granted_credits, reserved_credits, consumed_credits, updated_at")
      .eq("brand_id", brandId)
      .maybeSingle();

    if (balanceError) {
      throw balanceError;
    }

    availableCredits = balanceRow ? toCreditBalanceSnapshot(balanceRow).availableCredits : 0;
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="font-heading text-3xl text-foreground">Welcome back, {displayName}</h1>
        <p className="max-w-2xl text-muted-foreground">
          Publish active products, copy each public try-on link, and share it with shoppers. They
          upload only their photo.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/80 bg-surface/80">
          <CardHeader className="pb-2">
            <CardDescription>Active products</CardDescription>
            <CardTitle className="font-heading text-3xl">{activeProductCount ?? 0}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{productCount ?? 0} in the catalog</p>
          </CardContent>
        </Card>
        <Card className="border-border/80 bg-surface/80">
          <CardHeader className="pb-2">
            <CardDescription>Available credits</CardDescription>
            <CardTitle className="font-heading text-3xl">
              {availableCredits === null ? "—" : availableCredits}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {availableCredits === null
                ? "Credit balances are hidden for your role."
                : availableCredits > 0
                  ? "Shoppers can start try-ons while this balance lasts."
                  : "Ask Dekhlo to add credits before shoppers generate try-ons."}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/80 bg-surface/80">
          <CardHeader className="pb-2">
            <CardDescription>Your role</CardDescription>
            <CardTitle className="font-heading text-3xl">{formatRole(context.currentRole)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{brand.name}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/80 bg-surface/80">
        <CardHeader>
          <CardTitle className="font-heading text-xl">Share try-on</CardTitle>
          <CardDescription>
            Each active product has its own link under /try/{brand.slug}/your-product.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Open Products, activate the item, and copy the public link. Inactive products stay in
            the catalog and are not available to shoppers.
          </p>
          <Link href="/dashboard/products" className="text-accent-700 underline">
            Go to products
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
