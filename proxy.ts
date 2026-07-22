import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { buildLoginRedirectPath, sanitizeRedirectPath } from "@/lib/auth/safe-redirect";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/env";

const PROTECTED_PREFIXES = ["/dashboard", "/onboarding"] as const;
const AUTH_ENTRY_PATHS = ["/auth/login", "/auth/sign-up"] as const;

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isAuthEntryPath(pathname: string): boolean {
  return AUTH_ENTRY_PATHS.some((path) => pathname === path);
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const pathname = request.nextUrl.pathname;

  const supabase = createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
      },
    },
  });

  const { data: userData } = await supabase.auth.getUser();
  const isAuthenticated = !!userData.user;

  if (pathname === "/auth/reset-password") {
    return response;
  }

  if (pathname === "/auth/confirm") {
    return response;
  }

  if (!isAuthenticated && isProtectedPath(pathname)) {
    const loginPath = buildLoginRedirectPath(`${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(new URL(loginPath, request.url));
  }

  if (isAuthenticated && isAuthEntryPath(pathname)) {
    const next = sanitizeRedirectPath(request.nextUrl.searchParams.get("next"), "/dashboard");
    return NextResponse.redirect(new URL(next, request.url));
  }

  if (isAuthenticated && pathname === "/auth/forgot-password") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
