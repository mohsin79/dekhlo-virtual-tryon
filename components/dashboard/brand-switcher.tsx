"use client";

import { setActiveBrandAction } from "@/app/dashboard/brand-actions";
import { Button } from "@/components/ui/button";
import type { UserContext } from "@/lib/auth/get-user-context";

export function BrandSwitcher({ context }: { context: UserContext }) {
  if (context.memberships.length < 2 || !context.currentBrand) {
    return null;
  }

  return (
    <form action={setActiveBrandAction} className="space-y-2 px-3">
      <label htmlFor="active-brand" className="text-xs uppercase tracking-wide text-muted-foreground">
        Switch brand
      </label>
      <select
        id="active-brand"
        name="brandId"
        defaultValue={context.currentBrand.brandId}
        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
        onChange={(event) => {
          event.currentTarget.form?.requestSubmit();
        }}
      >
        {context.memberships.map((membership) => (
          <option key={membership.brandId} value={membership.brandId}>
            {membership.brand.name}
          </option>
        ))}
      </select>
      <Button type="submit" variant="outline" size="sm">
        Use brand
      </Button>
    </form>
  );
}
