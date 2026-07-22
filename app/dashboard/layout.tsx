import { redirect } from "next/navigation";
import { DashboardShellClient } from "@/components/dashboard/dashboard-shell-client";
import { requireUserContext } from "@/lib/auth/get-user-context";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await requireUserContext("/dashboard");

  if (context.memberships.length === 0) {
    redirect("/onboarding");
  }

  return <DashboardShellClient context={context}>{children}</DashboardShellClient>;
}
