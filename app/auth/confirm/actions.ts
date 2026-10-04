"use server";

import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { authErrorPath } from "@/lib/auth/auth-error-reason";
import { resolvePostAuthRedirect } from "@/lib/auth/get-user-context";
import { sanitizeRedirectPath } from "@/lib/auth/safe-redirect";
import { getSiteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const VALID_OTP_TYPES = new Set<EmailOtpType>([
  "email",
  "signup",
  "recovery",
  "invite",
  "magiclink",
  "email_change",
]);

function readField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function redirectTo(path: string): never {
  redirect(new URL(path, getSiteUrl()).toString());
}

/**
 * Confirms an auth link only after an explicit button press.
 * GET /auth/confirm must not call this — inbox prefetch would consume the token.
 */
export async function completeAuthCallbackAction(formData: FormData): Promise<void> {
  const tokenHash = readField(formData, "tokenHash");
  const type = readField(formData, "type");
  const code = readField(formData, "code");
  const next = sanitizeRedirectPath(readField(formData, "next"), "");

  const supabase = await createClient();
  let authenticated = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      redirectTo(authErrorPath("expired_or_used"));
    }

    authenticated = true;
  } else if (tokenHash && type && VALID_OTP_TYPES.has(type as EmailOtpType)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });

    if (error) {
      redirectTo(authErrorPath("expired_or_used"));
    }

    authenticated = true;
  } else {
    redirectTo(authErrorPath("missing_callback"));
  }

  if (!authenticated) {
    redirectTo(authErrorPath("confirmation_failed"));
  }

  if (type === "recovery") {
    redirectTo(next || "/auth/reset-password");
  }

  const { data: membershipRows } = await supabase
    .from("brand_members")
    .select("brand_id")
    .limit(1);

  redirectTo(resolvePostAuthRedirect((membershipRows ?? []).length > 0, next || null));
}
