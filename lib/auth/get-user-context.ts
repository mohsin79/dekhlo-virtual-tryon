import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildLoginRedirectPath, sanitizeRedirectPath } from "@/lib/auth/safe-redirect";
import type { Database } from "@/lib/supabase/database.types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type BrandRole = Database["public"]["Enums"]["brand_role"];
type Brand = Database["public"]["Tables"]["brands"]["Row"];

export type BrandMembership = {
  brandId: string;
  role: BrandRole;
  brand: Pick<Brand, "id" | "name" | "slug">;
};

export type UserContext = {
  userId: string;
  email: string | null;
  profile: Profile;
  memberships: BrandMembership[];
  currentBrand: BrandMembership | null;
  currentRole: BrandRole | null;
};

export type AuthenticatedUser = {
  id: string;
  email: string | null;
};

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    return null;
  }

  const sub = data.claims.sub;

  if (typeof sub !== "string" || sub.length === 0) {
    return null;
  }

  const emailClaim = data.claims.email;
  const email = typeof emailClaim === "string" ? emailClaim : null;

  return {
    id: sub,
    email,
  };
}

export async function requireUser(next?: string | null): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect(buildLoginRedirectPath(next));
  }

  return user;
}

export async function getUserContext(): Promise<UserContext | null> {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return null;
  }

  const user = authData.user;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_path, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  if (!profile) {
    throw new Error("Profile integrity error: authenticated user has no profile row.");
  }

  const { data: membershipRows, error: membershipError } = await supabase
    .from("brand_members")
    .select("brand_id, role, brands ( id, name, slug )")
    .order("brand_id", { ascending: true });

  if (membershipError) {
    throw membershipError;
  }

  const memberships: BrandMembership[] = (membershipRows ?? [])
    .map((row) => {
      const brand = row.brands;

      if (!brand || Array.isArray(brand)) {
        return null;
      }

      return {
        brandId: row.brand_id,
        role: row.role,
        brand: {
          id: brand.id,
          name: brand.name,
          slug: brand.slug,
        },
      };
    })
    .filter((value): value is BrandMembership => value !== null);

  const currentBrand = memberships[0] ?? null;

  return {
    userId: user.id,
    email: user.email ?? null,
    profile,
    memberships,
    currentBrand,
    currentRole: currentBrand?.role ?? null,
  };
}

export async function requireUserContext(next?: string | null): Promise<UserContext> {
  const context = await getUserContext();

  if (!context) {
    redirect(buildLoginRedirectPath(next));
  }

  return context;
}

export function resolvePostAuthRedirect(
  hasMembership: boolean,
  next?: string | null,
): string {
  const safeNext = sanitizeRedirectPath(next, "");

  if (safeNext) {
    return safeNext;
  }

  return hasMembership ? "/dashboard" : "/onboarding";
}
