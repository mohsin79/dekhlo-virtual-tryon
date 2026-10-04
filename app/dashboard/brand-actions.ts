"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { ACTIVE_BRAND_COOKIE } from "@/lib/auth/active-brand";
import { getUserContext } from "@/lib/auth/get-user-context";

export async function setActiveBrandAction(formData: FormData): Promise<void> {
  const brandId = formData.get("brandId");

  if (typeof brandId !== "string" || brandId.length === 0) {
    return;
  }

  const context = await getUserContext();

  if (!context?.memberships.some((membership) => membership.brandId === brandId)) {
    return;
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_BRAND_COOKIE, brandId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/dashboard", "layout");
}
