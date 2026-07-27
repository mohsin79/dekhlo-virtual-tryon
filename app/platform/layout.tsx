import { PlatformShellClient } from "@/components/platform/platform-shell-client";
import { requirePlatformAdmin } from "@/lib/platform/require-platform-admin";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await requirePlatformAdmin("/platform");

  return <PlatformShellClient context={context}>{children}</PlatformShellClient>;
}
