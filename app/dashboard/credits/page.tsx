import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserContext } from "@/lib/auth/get-user-context";
import { toCreditBalanceSnapshot } from "@/lib/credits/balance";
import { canViewCredits } from "@/lib/credits/permissions";
import { createClient } from "@/lib/supabase/server";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTransactionType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function formatMetadataSummary(metadata: Record<string, unknown> | null): string | null {
  if (!metadata || Object.keys(metadata).length === 0) {
    return null;
  }

  const reason = metadata.reason;

  if (typeof reason === "string" && reason.trim()) {
    return reason.trim();
  }

  const source = metadata.source;

  if (typeof source === "string" && source.trim()) {
    return source.trim();
  }

  return null;
}

export default async function CreditsPage() {
  const context = await requireUserContext("/dashboard/credits");

  if (!context.currentBrand) {
    return null;
  }

  if (!canViewCredits(context.currentRole)) {
    return (
      <div className="space-y-6">
        <section className="space-y-2">
          <h1 className="font-heading text-3xl text-foreground">Credits</h1>
          <p className="max-w-2xl text-muted-foreground">
            Credit balance and transaction history are not available for your role.
          </p>
        </section>
        <Card className="border-border/80 bg-surface/80">
          <CardHeader>
            <CardTitle className="font-heading text-xl">Access unavailable</CardTitle>
            <CardDescription>
              Editors can manage products but cannot view credit balances or transactions. Contact
              a brand owner or admin if you need credit information.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const supabase = await createClient();
  const brandId = context.currentBrand.brandId;

  const [{ data: balanceRow, error: balanceError }, { data: transactions, error: transactionsError }] =
    await Promise.all([
      supabase
        .from("brand_credit_balances")
        .select("brand_id, granted_credits, reserved_credits, consumed_credits, updated_at")
        .eq("brand_id", brandId)
        .maybeSingle(),
      supabase
        .from("credit_transactions")
        .select("id, type, amount, metadata, created_at")
        .eq("brand_id", brandId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  if (balanceError) {
    throw balanceError;
  }

  if (transactionsError) {
    throw transactionsError;
  }

  const balance = balanceRow ? toCreditBalanceSnapshot(balanceRow) : null;

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="font-heading text-3xl text-foreground">Credits</h1>
        <p className="max-w-2xl text-muted-foreground">
          Read-only credit balance and recent transactions for {context.currentBrand.brand.name}.
          Purchases and try-on usage will be added in later phases.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border/80 bg-surface/80">
          <CardHeader className="pb-2">
            <CardDescription>Available</CardDescription>
            <CardTitle className="font-heading text-3xl">{balance?.availableCredits ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border/80 bg-surface/80">
          <CardHeader className="pb-2">
            <CardDescription>Granted</CardDescription>
            <CardTitle className="font-heading text-3xl">{balance?.grantedCredits ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border/80 bg-surface/80">
          <CardHeader className="pb-2">
            <CardDescription>Reserved</CardDescription>
            <CardTitle className="font-heading text-3xl">{balance?.reservedCredits ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border/80 bg-surface/80">
          <CardHeader className="pb-2">
            <CardDescription>Consumed</CardDescription>
            <CardTitle className="font-heading text-3xl">{balance?.consumedCredits ?? 0}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      {balance ? (
        <p className="text-sm text-muted-foreground">
          Balance last updated {formatDate(balance.updatedAt)}.
        </p>
      ) : null}

      <Card className="border-border/80 bg-surface/80">
        <CardHeader>
          <CardTitle className="font-heading text-xl">Recent transactions</CardTitle>
          <CardDescription>Append-only credit ledger entries for this brand.</CardDescription>
        </CardHeader>
        <CardContent>
          {(transactions ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No credit transactions yet.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {(transactions ?? []).map((transaction) => {
                const metadataSummary = formatMetadataSummary(
                  transaction.metadata as Record<string, unknown> | null,
                );

                return (
                  <li key={transaction.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">
                        {formatTransactionType(transaction.type)} · {transaction.amount}
                      </p>
                      {metadataSummary ? (
                        <p className="text-sm text-muted-foreground">{metadataSummary}</p>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground">{formatDate(transaction.created_at)}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
