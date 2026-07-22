"use client";

import { usePathname } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import type { UserContext } from "@/lib/auth/get-user-context";

export function DashboardShellClient({
  context,
  children,
}: {
  context: UserContext;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <DashboardShell context={context} pathname={pathname}>
      {children}
    </DashboardShell>
  );
}
