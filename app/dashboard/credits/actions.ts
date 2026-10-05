"use server";

import { redirect } from "next/navigation";
import { requireUserContext } from "@/lib/auth/get-user-context";
import { canPurchaseCredits } from "@/lib/credits/permissions";
import {
  checkoutErrorCode,
  startSafepayCreditPackCheckout,
} from "@/lib/payments/credit-pack-service";

export async function startCreditPackCheckout(formData: FormData): Promise<void> {
  const context = await requireUserContext("/dashboard/credits");

  if (!context.currentBrand || !canPurchaseCredits(context.currentRole)) {
    redirect("/dashboard/credits?purchase=forbidden");
  }

  const packId = String(formData.get("packId") ?? "");
  let checkoutUrl: string;

  try {
    checkoutUrl = await startSafepayCreditPackCheckout({
      brandId: context.currentBrand.brandId,
      userId: context.userId,
      packId,
    });
  } catch (error) {
    console.error("[payments] checkout_failed", { code: checkoutErrorCode(error) });
    redirect(`/dashboard/credits?purchase=${checkoutErrorCode(error)}`);
  }

  redirect(checkoutUrl);
}
