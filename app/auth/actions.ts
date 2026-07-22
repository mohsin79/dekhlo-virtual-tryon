"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mapAuthErrorMessage, mapBrandOnboardingErrorMessage } from "@/lib/auth/errors";
import { resolvePostAuthRedirect } from "@/lib/auth/get-user-context";
import { sanitizeRedirectPath } from "@/lib/auth/safe-redirect";
import { getSiteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from "@/lib/validation/auth";
import { brandOnboardingSchema } from "@/lib/validation/brand";

export type AuthActionState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
  pending?: boolean;
};

function fieldErrorsFromZod(error: { flatten: () => { fieldErrors: Record<string, string[]> } }) {
  const flattened = error.flatten().fieldErrors;
  const fieldErrors: Record<string, string> = {};

  for (const [key, messages] of Object.entries(flattened)) {
    if (messages?.[0]) {
      fieldErrors[key] = messages[0];
    }
  }

  return fieldErrors;
}

export async function loginAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createClient();
  const next = sanitizeRedirectPath(formData.get("next")?.toString(), "");

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: mapAuthErrorMessage(error) };
  }

  const { data: membershipRows } = await supabase
    .from("brand_members")
    .select("brand_id")
    .limit(1);

  revalidatePath("/dashboard");
  revalidatePath("/onboarding");
  redirect(resolvePostAuthRedirect((membershipRows ?? []).length > 0, next || null));
}

export async function signupAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signupSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createClient();
  const siteUrl = getSiteUrl();

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.fullName,
      },
      emailRedirectTo: `${siteUrl}/auth/confirm?type=email&next=/onboarding`,
    },
  });

  if (error) {
    return { error: mapAuthErrorMessage(error) };
  }

  if (data.session) {
    revalidatePath("/dashboard");
    revalidatePath("/onboarding");
    redirect("/onboarding");
  }

  return {
    success:
      "Check your email for a confirmation link. Once confirmed, you can finish setting up your brand.",
  };
}

export async function forgotPasswordAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createClient();
  const siteUrl = getSiteUrl();
  const redirectTo = `${siteUrl}/auth/confirm?type=recovery&next=${encodeURIComponent("/auth/reset-password")}`;

  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo,
  });

  return {
    success: "If an account exists for that email, a password reset link has been sent.",
  };
}

export async function resetPasswordAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return {
      error: "Your reset session has expired. Request a new password reset link.",
    };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    return { error: mapAuthErrorMessage(error) };
  }

  const { data: membershipRows } = await supabase
    .from("brand_members")
    .select("brand_id")
    .limit(1);

  revalidatePath("/dashboard");
  revalidatePath("/onboarding");
  redirect(resolvePostAuthRedirect((membershipRows ?? []).length > 0, null));
}

export async function createBrandAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = brandOnboardingSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    redirect("/auth/login?next=/onboarding");
  }

  const { error } = await supabase.rpc("create_brand_with_owner", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
  });

  if (error) {
    return { error: mapBrandOnboardingErrorMessage(error) };
  }

  revalidatePath("/dashboard");
  revalidatePath("/onboarding");
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth/login");
}
