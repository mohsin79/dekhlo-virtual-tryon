const AUTH_LOOP_PATHS = [
  "/auth/login",
  "/auth/sign-up",
  "/auth/forgot-password",
  "/auth/confirm",
  "/auth/error",
] as const;

export function sanitizeRedirectPath(
  next: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!next) {
    return fallback;
  }

  const value = next.trim();

  if (!value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  if (value.includes("://") || value.includes("\\")) {
    return fallback;
  }

  const pathname = value.split("?")[0]?.split("#")[0] ?? value;

  if (AUTH_LOOP_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return fallback;
  }

  return value;
}

export function buildLoginRedirectPath(next: string | null | undefined): string {
  const safeNext = sanitizeRedirectPath(next, "");

  if (!safeNext) {
    return "/auth/login";
  }

  const params = new URLSearchParams({ next: safeNext });
  return `/auth/login?${params.toString()}`;
}
