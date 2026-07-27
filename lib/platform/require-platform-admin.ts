import "server-only";

import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth/get-user-context";
import { buildLoginRedirectPath } from "@/lib/auth/safe-redirect";
import { isPlatformAdminProfile } from "@/lib/platform/is-platform-admin-profile";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type PlatformAdminProfile = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "platform_role"
>;

export type PlatformAdminContext = {
  userId: string;
  email: string | null;
  profile: PlatformAdminProfile;
};

export async function loadPlatformAdminProfile(
  userId: string,
): Promise<PlatformAdminProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, platform_role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function getPlatformAdminContext(): Promise<PlatformAdminContext | null> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return null;
  }

  const profile = await loadPlatformAdminProfile(user.id);

  if (!profile || !isPlatformAdminProfile(profile)) {
    return null;
  }

  return {
    userId: user.id,
    email: user.email,
    profile,
  };
}

export async function requirePlatformAdmin(nextPath?: string | null): Promise<PlatformAdminContext> {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect(buildLoginRedirectPath(nextPath ?? "/platform"));
  }

  const profile = await loadPlatformAdminProfile(user.id);

  if (!profile || !isPlatformAdminProfile(profile)) {
    notFound();
  }

  return {
    userId: user.id,
    email: user.email,
    profile,
  };
}
