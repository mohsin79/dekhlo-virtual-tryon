import { startCreditPackCheckout } from "@/app/dashboard/credits/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type CreditPack,
  creditPackSavingsLabel,
  formatPerTryOnPrice,
  formatPkrFromPaisa,
} from "@/lib/payments/credit-packs";

export function CreditPackCard({ pack, canBuy }: { pack: CreditPack; canBuy: boolean }) {
  const savings = creditPackSavingsLabel(pack);

  return (
    <Card className="border-border/80 bg-surface/80">
      <CardHeader>
        <CardTitle className="font-heading text-xl">{pack.name}</CardTitle>
        <CardDescription>
          {pack.credits} try-on credits · {formatPkrFromPaisa(pack.amountPaisa)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm font-medium text-foreground">{formatPerTryOnPrice(pack)}</p>
        <div className="flex min-h-6 flex-wrap gap-1.5">
          {savings ? (
            <>
              <span className="tag tag-accent-2">{savings.amount}</span>
              <span className="tag tag-accent-2">{savings.percent}</span>
            </>
          ) : null}
        </div>
        {canBuy ? (
          <form action={startCreditPackCheckout}>
            <input type="hidden" name="packId" value={pack.id} />
            <Button type="submit">Pay with Safepay</Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">Owners and admins can purchase this pack.</p>
        )}
      </CardContent>
    </Card>
  );
}
