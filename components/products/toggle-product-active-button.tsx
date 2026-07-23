"use client";

import { useTransition } from "react";
import { toggleProductActiveAction } from "@/app/dashboard/products/actions";
import { Button } from "@/components/ui/button";

export function ToggleProductActiveButton({
  productId,
  isActive,
}: {
  productId: string;
  isActive: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const formData = new FormData();
          formData.set("productId", productId);
          formData.set("isActive", isActive ? "false" : "true");
          await toggleProductActiveAction(formData);
        });
      }}
    >
      {pending ? "Updating..." : isActive ? "Deactivate" : "Activate"}
    </Button>
  );
}
