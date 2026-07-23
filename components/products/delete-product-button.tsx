"use client";

import { useState } from "react";
import { deleteProductAction } from "@/app/dashboard/products/actions";
import { Button } from "@/components/ui/button";

export function DeleteProductButton({ productId, productName }: { productId: string; productName: string }) {
  const [pending, setPending] = useState(false);

  return (
    <form
      action={async (formData) => {
        setPending(true);
        await deleteProductAction(formData);
      }}
    >
      <input type="hidden" name="productId" value={productId} />
      <Button
        type="submit"
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={(event) => {
          const confirmed = window.confirm(
            `Delete “${productName}”? This removes the product and its image from your catalog.`,
          );

          if (!confirmed) {
            event.preventDefault();
          }
        }}
      >
        {pending ? "Deleting..." : "Delete"}
      </Button>
    </form>
  );
}
