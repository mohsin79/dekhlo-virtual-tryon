import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
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

function redirectTo(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, getSiteUrl()));
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const code = requestUrl.searchParams.get("code");
  const next = sanitizeRedirectPath(requestUrl.searchParams.get("next"), "");

  const supabase = await createClient();
  let authenticated = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return redirectTo("/auth/error");
    }

    authenticated = true;
  } else if (tokenHash && type && VALID_OTP_TYPES.has(type as EmailOtpType)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });

    if (error) {
      return redirectTo("/auth/error");
    }

    authenticated = true;
  } else {
    return redirectTo("/auth/error");
  }

  if (!authenticated) {
    return redirectTo("/auth/error");
  }

  if (type === "recovery") {
    return redirectTo(next || "/auth/reset-password");
  }

  const { data: membershipRows } = await supabase
    .from("brand_members")
    .select("brand_id")
    .limit(1);

  const destination = resolvePostAuthRedirect(
    (membershipRows ?? []).length > 0,
    next || null,
  );

  return redirectTo(destination);
}
