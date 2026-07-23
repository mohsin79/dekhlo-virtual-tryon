"use client";

import { useActionState, useState } from "react";
import {
  createProductAction,
  updateProductAction,
  type ProductActionState,
} from "@/app/dashboard/products/actions";
import { suggestProductSlug } from "@/lib/validation/product";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const initialState: ProductActionState = {};

type ProductFormValues = {
  name: string;
  slug: string;
  isActive: boolean;
};

export function ProductForm({
  mode,
  productId,
  initialValues,
  currentImagePath,
  currentImageUrl,
}: {
  mode: "create" | "edit";
  productId?: string;
  initialValues?: ProductFormValues;
  currentImagePath?: string | null;
  currentImageUrl?: string | null;
}) {
  const action = mode === "create" ? createProductAction : updateProductAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  const [name, setName] = useState(initialValues?.name ?? "");
  const [slug, setSlug] = useState(initialValues?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(mode === "edit");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const suggestedSlug = suggestProductSlug(name);
  const slugValue = slugEdited ? slug : suggestedSlug;

  return (
    <Card className="border-border/80 bg-surface/80">
      <CardHeader>
        <CardTitle className="font-heading text-2xl">
          {mode === "create" ? "Create product" : "Edit product"}
        </CardTitle>
        <CardDescription>
          {mode === "create"
            ? "Add a catalog item with a public product image for your brand."
            : "Update product details or replace the product image."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5">
          {productId ? <input type="hidden" name="productId" value={productId} /> : null}

          {state.error ? (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">Product name</FieldLabel>
              <Input
                id="name"
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
              {state.fieldErrors?.name ? <FieldError>{state.fieldErrors.name}</FieldError> : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="slug">Product slug</FieldLabel>
              <Input
                id="slug"
                name="slug"
                value={slugValue}
                onChange={(event) => {
                  setSlugEdited(true);
                  setSlug(event.target.value);
                }}
                required
              />
              <FieldDescription>
                Unique within your brand. Used in future public try-on routes.
              </FieldDescription>
              {state.fieldErrors?.slug ? <FieldError>{state.fieldErrors.slug}</FieldError> : null}
            </Field>

            <Field>
              <div className="flex items-center gap-2">
                <input
                  id="isActive"
                  name="isActive"
                  type="checkbox"
                  value="true"
                  defaultChecked={initialValues?.isActive ?? true}
                  className="size-4 rounded border border-border"
                />
                <FieldLabel htmlFor="isActive" className="mb-0">
                  Active in catalog
                </FieldLabel>
              </div>
              <FieldDescription>
                Inactive products remain visible to your team but are deferred from public access
                until Phase 6.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="image">
                Product image{mode === "create" ? "" : " (optional replacement)"}
              </FieldLabel>
              <Input
                id="image"
                name="image"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                required={mode === "create"}
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  if (!file) {
                    setPreviewUrl(null);
                    return;
                  }

                  setPreviewUrl(URL.createObjectURL(file));
                }}
              />
              {state.fieldErrors?.image ? <FieldError>{state.fieldErrors.image}</FieldError> : null}
              {(previewUrl || currentImageUrl) && (
                <div className="mt-3 w-40 overflow-hidden rounded-lg border border-border">
                  {previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewUrl} alt="Selected product preview" className="aspect-square w-full object-cover" />
                  ) : currentImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={currentImageUrl} alt="Current product image" className="aspect-square w-full object-cover" />
                  ) : null}
                </div>
              )}
              {mode === "edit" && !previewUrl && currentImagePath ? (
                <FieldDescription>Current image path is stored securely; upload a file to replace it.</FieldDescription>
              ) : null}
            </Field>
          </FieldGroup>

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : mode === "create" ? "Create product" : "Save changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
