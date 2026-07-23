import Link from "next/link";
import { LogoutButton } from "@/components/dashboard/logout-button";
import { Logo } from "@/components/Logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { UserContext } from "@/lib/auth/get-user-context";
import { canViewCredits } from "@/lib/credits/permissions";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/products", label: "Products" },
  { href: "/dashboard/credits", label: "Credits", requiresCreditAccess: true },
] as const;

function formatRole(role: string | null): string {
  if (!role) {
    return "Member";
  }

  return role.charAt(0).toUpperCase() + role.slice(1);
}

function initials(name: string | null, email: string | null): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "U";
  }

  return email?.slice(0, 2).toUpperCase() ?? "U";
}

function SidebarNav({ pathname, context }: { pathname: string; context: UserContext }) {
  const items = NAV_ITEMS.filter(
    (item) => !("requiresCreditAccess" in item) || canViewCredits(context.currentRole),
  );

  return (
    <nav className="flex flex-col gap-1" aria-label="Dashboard">
      {items.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));

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

function BrandSummary({ context }: { context: UserContext }) {
  return (
    <div className="space-y-1 px-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Current brand</p>
      <p className="font-heading text-lg text-foreground">{context.currentBrand?.brand.name}</p>
      <p className="text-sm text-muted-foreground">{formatRole(context.currentRole)}</p>
    </div>
  );
}

export function DashboardShell({
  context,
  pathname,
  children,
}: {
  context: UserContext;
  pathname: string;
  children: React.ReactNode;
}) {
  const displayName = context.profile.full_name?.trim() || context.email || "Merchant";

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl">
        <aside className="hidden w-64 shrink-0 border-r border-border/70 bg-surface/60 p-6 md:flex md:flex-col md:gap-6">
          <Link href="/dashboard" className="no-underline">
            <Logo />
          </Link>
          <BrandSummary context={context} />
          <Separator />
          <SidebarNav pathname={pathname} context={context} />
          <div className="mt-auto space-y-3">
            <Separator />
            <LogoutButton />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-4 border-b border-border/70 bg-surface/40 px-4 py-4 md:px-8">
            <Sheet>
              <SheetTrigger
                className="inline-flex rounded-lg border border-border px-3 py-2 text-sm font-medium md:hidden"
                aria-label="Open navigation menu"
              >
                Menu
              </SheetTrigger>
              <SheetContent side="left" className="w-72">
                <SheetHeader>
                  <SheetTitle className="font-heading">Dekhlo dashboard</SheetTitle>
                </SheetHeader>
                <div className="mt-6 space-y-6">
                  <BrandSummary context={context} />
                  <SidebarNav pathname={pathname} context={context} />
                  <LogoutButton />
                </div>
              </SheetContent>
            </Sheet>

            <div className="min-w-0 flex-1">
              <p className="truncate font-heading text-lg">{context.currentBrand?.brand.name}</p>
              <p className="truncate text-sm text-muted-foreground">{formatRole(context.currentRole)}</p>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-full border border-border px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="size-8">
                  <AvatarFallback>{initials(context.profile.full_name, context.email)}</AvatarFallback>
                </Avatar>
                <span className="hidden max-w-40 truncate sm:inline">{displayName}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="space-y-1">
                    <p className="font-medium">{displayName}</p>
                    <p className="text-xs font-normal text-muted-foreground">{context.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>{formatRole(context.currentRole)}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          <main className="flex-1 px-4 py-8 md:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
