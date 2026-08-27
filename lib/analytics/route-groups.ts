export const ANALYTICS_ROUTE_GROUPS = [
  "/",
  "/auth",
  "/dashboard",
  "/dashboard/leads",
  "/dashboard/products",
  "/try",
  "/demo",
] as const;

export type AnalyticsRouteGroup = (typeof ANALYTICS_ROUTE_GROUPS)[number];

export function pathnameToRouteGroup(pathname: string): AnalyticsRouteGroup {
  if (pathname === "/") {
    return "/";
  }

  if (pathname.startsWith("/auth") || pathname.startsWith("/onboarding")) {
    return "/auth";
  }

  if (pathname === "/dashboard/leads" || pathname.startsWith("/dashboard/leads/")) {
    return "/dashboard/leads";
  }

  if (pathname.startsWith("/dashboard/products")) {
    return "/dashboard/products";
  }

  if (pathname.startsWith("/dashboard")) {
    return "/dashboard";
  }

  if (pathname.startsWith("/try/")) {
    return "/try";
  }

  if (pathname.startsWith("/demo")) {
    return "/demo";
  }

  return "/";
}

export function sanitizePageviewPathname(pathname: string): AnalyticsRouteGroup {
  return pathnameToRouteGroup(pathname);
}
