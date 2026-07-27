"use client";

import { usePathname } from "next/navigation";
import { PlatformShell } from "@/components/platform/platform-shell";
import type { PlatformAdminContext } from "@/lib/platform/require-platform-admin";

export function PlatformShellClient({
  context,
  children,
}: {
  context: PlatformAdminContext;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <PlatformShell context={context} pathname={pathname}>
      {children}
    </PlatformShell>
  );
}
