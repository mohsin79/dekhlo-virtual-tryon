import Link from "next/link";
import { CreditCheckoutStatus } from "@/components/dashboard/credit-pack-status";
import { Button } from "@/components/ui/button";
import { requireUserContext } from "@/lib/auth/get-user-context";
import { canViewCredits } from "@/lib/credits/permissions";
import { reconcileCreditPackOrderForBrand } from "@/lib/payments/credit-pack-service";

const ORDER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CreditCheckoutSuccessPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const context = await requireUserContext("/dashboard/credits");
  const { orderId } = await params;

  if (!context.currentBrand || !canViewCredits(context.currentRole) || !ORDER_ID_PATTERN.test(orderId)) {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-3xl text-foreground">Payment</h1>
        <p className="text-muted-foreground">This payment could not be found for your brand.</p>
      </div>
    );
  }

  const result = await reconcileCreditPackOrderForBrand(orderId, context.currentBrand.brandId, {
    abandonIfPending: false,
  });

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="font-heading text-3xl text-foreground">Payment</h1>
        <p className="max-w-2xl text-muted-foreground">
          Returning from Safepay does not add credits. Dekhlo checks the payment with Safepay
          before updating the balance.
        </p>
      </section>
      {result.order ? (
        <CreditCheckoutStatus
          order={result.order}
          confirmationUnavailable={result.confirmationUnavailable}
          intent="success"
        />
      ) : (
        <p className="text-muted-foreground">This payment could not be found for your brand.</p>
      )}
      <Link href="/dashboard/credits" className="inline-flex">
        <Button type="button" variant="outline">
          Back to credits
        </Button>
      </Link>
    </div>
  );
}
