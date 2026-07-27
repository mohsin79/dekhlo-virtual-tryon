"use client";

import Link from "next/link";
import { LogoutButton } from "@/components/dashboard/logout-button";
import { Logo } from "@/components/Logo";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import type { PlatformAdminContext } from "@/lib/platform/require-platform-admin";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/platform", label: "Overview" },
  { href: "/platform/brands", label: "Brands" },
  { href: "/platform/audit", label: "Audit log" },
] as const;

function SidebarNav({ pathname }: { pathname: string }) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Platform administration">
      {NAV_ITEMS.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/platform" && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-accent/15 text-accent-700"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function PlatformShell({
  context,
  pathname,
  children,
}: {
  context: PlatformAdminContext;
  pathname: string;
  children: React.ReactNode;
}) {
  const displayName = context.profile.full_name?.trim() || context.email || "Platform admin";

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl">
        <aside className="hidden w-64 shrink-0 border-r border-border/70 bg-surface/60 p-6 md:flex md:flex-col md:gap-6">
          <Link href="/platform" className="no-underline">
            <Logo />
          </Link>
          <div className="space-y-1 px-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Console</p>
            <p className="font-heading text-lg text-foreground">Dekhlo Platform Administration</p>
            <p className="text-sm text-muted-foreground">{displayName}</p>
          </div>
          <Separator />
          <SidebarNav pathname={pathname} />
          <div className="mt-auto space-y-3">
            <Separator />
            <Link
              href="/dashboard"
              className="block rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Merchant dashboard
            </Link>
            <LogoutButton />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-4 border-b border-border/70 bg-surface/40 px-4 py-4 md:px-8">
            <Sheet>
              <SheetTrigger
                className="inline-flex rounded-lg border border-border px-3 py-2 text-sm font-medium md:hidden"
                aria-label="Open platform navigation menu"
              >
                Menu
              </SheetTrigger>
              <SheetContent side="left" className="w-72">
                <SheetHeader>
                  <SheetTitle className="font-heading">Platform administration</SheetTitle>
                </SheetHeader>
                <div className="mt-6 space-y-6">
                  <SidebarNav pathname={pathname} />
                  <Link
                    href="/dashboard"
                    className="block rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Merchant dashboard
                  </Link>
                  <LogoutButton />
                </div>
              </SheetContent>
            </Sheet>
            <div className="min-w-0 flex-1">
              <p className="truncate font-heading text-lg">Dekhlo Platform Administration</p>
              <p className="truncate text-sm text-muted-foreground">Platform operator console</p>
            </div>
          </header>
          <main className="flex-1 px-4 py-8 md:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
