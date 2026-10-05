import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPkrFromPaisa, getCreditPack } from "@/lib/payments/credit-packs";
import type { CreditPackOrder } from "@/lib/payments/types";

export function CreditCheckoutStatus({
  order,
  confirmationUnavailable,
  intent,
}: {
  order: CreditPackOrder;
  confirmationUnavailable: boolean;
  intent: "success" | "cancel";
}) {
  const pack = getCreditPack(order.packId);
  const packName = pack?.name ?? "Credit pack";
  const amount = formatPkrFromPaisa(order.amountPaisa);

  let title = "Payment pending";
  let description =
    "Safepay has not confirmed this payment yet. Credits are added only after that confirmation. Refresh this page in a moment.";

  if (order.status === "paid") {
    title = "Payment confirmed";
    description = `${order.credits} credits from the ${packName} pack (${amount}) are on this brand's balance.`;
  } else if (order.status === "failed") {
    title = "Payment failed";
    description = `The ${packName} pack (${amount}) was not paid. No credits were added.`;
  } else if (order.status === "cancelled") {
    title = "Checkout cancelled";
    description = `The ${packName} pack (${amount}) was not paid. No credits were added.`;
  } else if (confirmationUnavailable) {
    title = "Confirmation unavailable";
    description =
      "Dekhlo could not reach Safepay to confirm this payment. No credits were added. Refresh this page shortly.";
  } else if (intent === "cancel") {
    title = "Checkout cancelled";
    description = `The ${packName} pack (${amount}) was not paid. No credits were added.`;
  }

  return (
    <Card className="border-border/80 bg-surface/80">
      <CardHeader>
        <CardTitle className="font-heading text-xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Order {order.id}. Status: {order.status}.
        </p>
      </CardContent>
    </Card>
  );
}
