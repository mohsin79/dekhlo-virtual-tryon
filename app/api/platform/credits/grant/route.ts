import { handlePlatformCreditMutation } from "@/lib/platform/handle-credit-mutation";

export async function POST(request: Request) {
  return handlePlatformCreditMutation(request, "grant");
}
