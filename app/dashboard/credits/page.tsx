import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserContext } from "@/lib/auth/get-user-context";
import { toCreditBalanceSnapshot } from "@/lib/credits/balance";
import { canPurchaseCredits, canViewCredits } from "@/lib/credits/permissions";
import { formatCreditTransactionType } from "@/lib/credits/transaction-labels";
import {
  CREDIT_PACK_PRICE_NOTE,
  CREDIT_PACKS,
  formatPkrFromPaisa,
  getCreditPack,
} from "@/lib/payments/credit-packs";
import { startCreditPackCheckout } from "@/app/dashboard/credits/actions";
import { createClient } from "@/lib/supabase/server";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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

function purchaseMessage(code: string | undefined): string | null {
  switch (code) {
    case "forbidden":
      return "Only a brand owner or admin can buy credit packs.";
    case "unknown_pack":
      return "That credit pack is not available.";
    case "too_many_pending":
      return "This brand already has several unpaid checkouts. Finish or cancel one before starting another.";
    case "not_configured":
      return "Safepay is not configured on this server yet.";
    case "provider_unavailable":
    case "invalid_tracker":
    case "error":
      return "Safepay could not start checkout. No credits were added.";
    default:
      return null;
  }
}

function orderStatusLabel(status: string): string {
  switch (status) {
    case "paid":
      return "Paid";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Pending";
  }
}

export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ purchase?: string }>;
}) {
  const context = await requireUserContext("/dashboard/credits");
  const params = await searchParams;

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
  const canBuy = canPurchaseCredits(context.currentRole);
  const notice = purchaseMessage(params.purchase);

  const [
    { data: balanceRow, error: balanceError },
    { data: transactions, error: transactionsError },
    { data: orders, error: ordersError },
  ] = await Promise.all([
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
    supabase
      .from("credit_pack_orders")
      .select("id, pack_id, credits, amount_paisa, status, created_at")
      .eq("brand_id", brandId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  if (balanceError) {
    throw balanceError;
  }

  if (transactionsError) {
    throw transactionsError;
  }

  if (ordersError) {
    throw ordersError;
  }

  const balance = balanceRow ? toCreditBalanceSnapshot(balanceRow) : null;

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="font-heading text-3xl text-foreground">Credits</h1>
        <p className="max-w-2xl text-muted-foreground">
          Balance for {context.currentBrand.brand.name}. Each try-on reserves one credit and
          consumes it when generation finishes. Buy a one-time pack in PKR. Credits are added
          only after Safepay confirms the payment.
        </p>
      </section>

      {notice ? (
        <p className="rounded-lg border border-border/80 bg-surface/80 px-4 py-3 text-sm text-foreground">
          {notice}
        </p>
      ) : null}

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

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-heading text-xl text-foreground">Credit packs</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{CREDIT_PACK_PRICE_NOTE}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {CREDIT_PACKS.map((pack) => (
            <Card key={pack.id} className="border-border/80 bg-surface/80">
              <CardHeader>
                <CardTitle className="font-heading text-xl">{pack.name}</CardTitle>
                <CardDescription>
                  {pack.credits} try-on credits · {formatPkrFromPaisa(pack.amountPaisa)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {canBuy ? (
                  <form action={startCreditPackCheckout}>
                    <input type="hidden" name="packId" value={pack.id} />
                    <Button type="submit">Pay with Safepay</Button>
                  </form>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Owners and admins can purchase this pack.
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <Card className="border-border/80 bg-surface/80">
        <CardHeader>
          <CardTitle className="font-heading text-xl">Pack purchases</CardTitle>
          <CardDescription>Recent Safepay checkouts for this brand.</CardDescription>
        </CardHeader>
        <CardContent>
          {(orders ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No credit pack purchases yet.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {(orders ?? []).map((order) => {
                const pack = getCreditPack(order.pack_id);

                return (
                  <li key={order.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">
                        {pack?.name ?? "Credit pack"} · {order.credits} credits ·{" "}
                        {formatPkrFromPaisa(order.amount_paisa)}
                      </p>
                      <p className="text-sm text-muted-foreground">{orderStatusLabel(order.status)}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">{formatDate(order.created_at)}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

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
                        {formatCreditTransactionType(transaction.type)} · {transaction.amount}
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
