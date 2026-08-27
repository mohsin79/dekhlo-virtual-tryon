"use client";

import { useActionState, useState } from "react";
import { createBrandAction, type AuthActionState } from "@/app/auth/actions";
import { suggestBrandSlug } from "@/lib/validation/brand";
import { markPendingAnalyticsEvent } from "@/lib/analytics/pending-events";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const initialState: AuthActionState = {};

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(createBrandAction, initialState);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const suggestedSlug = suggestBrandSlug(name);
  const slugValue = slugEdited ? slug : suggestedSlug;

  return (
    <Card className="border-border/80 bg-surface/80 shadow-md backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="font-heading text-2xl">Create your brand</CardTitle>
        <CardDescription>
          Set up the workspace that will power your Dekhlo merchant dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={formAction}
          className="space-y-5"
          onSubmit={() => {
            markPendingAnalyticsEvent("brand_created");
          }}
        >
          {state.error ? (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">Brand name</FieldLabel>
              <Input
                id="name"
                name="name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                required
              />
              {state.fieldErrors?.name ? <FieldError>{state.fieldErrors.name}</FieldError> : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="slug">Brand URL slug</FieldLabel>
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
                This becomes part of your public brand URL, for example{" "}
                <span className="font-medium">/try/{slugValue || "your-brand"}</span> in a later phase.
              </FieldDescription>
              {state.fieldErrors?.slug ? <FieldError>{state.fieldErrors.slug}</FieldError> : null}
            </Field>
          </FieldGroup>

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Creating brand..." : "Create brand"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
