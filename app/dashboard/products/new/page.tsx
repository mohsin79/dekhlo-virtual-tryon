import { redirect } from "next/navigation";
import { ProductForm } from "@/components/products/product-form";
import { requireUserContext } from "@/lib/auth/get-user-context";
import { canManageProducts } from "@/lib/products/permissions";

export default async function NewProductPage() {
  const context = await requireUserContext("/dashboard/products/new");

  if (!canManageProducts(context.currentRole)) {
    redirect("/dashboard/products");
  }

  return <ProductForm mode="create" />;
}
