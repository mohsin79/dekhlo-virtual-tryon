"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { signupAction, type AuthActionState } from "@/app/auth/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { markPendingAnalyticsEvent } from "@/lib/analytics/pending-events";
import { trackAnalyticsEvent } from "@/lib/analytics/track";

const initialState: AuthActionState = {};

export function SignUpForm() {
  const [state, formAction, pending] = useActionState(signupAction, initialState);

  useEffect(() => {
    if (state.success) {
      trackAnalyticsEvent({
        event: "signup_completed",
        surface: "auth",
        route_group: "/auth",
        outcome: "completed",
      });
    }
  }, [state.success]);

  return (
    <Card className="border-border/80 bg-surface/80 shadow-md backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="font-heading text-2xl">Create account</CardTitle>
        <CardDescription>Start your Dekhlo merchant workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        {state.success ? (
          <Alert>
            <AlertDescription>{state.success}</AlertDescription>
          </Alert>
        ) : (
          <form
            action={formAction}
            className="space-y-5"
            onSubmit={() => {
              trackAnalyticsEvent({
                event: "signup_started",
                surface: "auth",
                route_group: "/auth",
              });
              markPendingAnalyticsEvent("signup_completed");
            }}
          >
            {state.error ? (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            ) : null}

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="fullName">Full name</FieldLabel>
                <Input id="fullName" name="fullName" autoComplete="name" required />
                {state.fieldErrors?.fullName ? (
                  <FieldError>{state.fieldErrors.fullName}</FieldError>
                ) : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" name="email" type="email" autoComplete="email" required />
                {state.fieldErrors?.email ? <FieldError>{state.fieldErrors.email}</FieldError> : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                />
                {state.fieldErrors?.password ? (
                  <FieldError>{state.fieldErrors.password}</FieldError>
                ) : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="confirmPassword">Confirm password</FieldLabel>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                />
                {state.fieldErrors?.confirmPassword ? (
                  <FieldError>{state.fieldErrors.confirmPassword}</FieldError>
                ) : null}
              </Field>
            </FieldGroup>

            <div className="text-sm">
              <Link href="/auth/login" className="text-accent hover:text-accent-700">
                Already have an account? Sign in
              </Link>
            </div>

            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Creating account..." : "Create account"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
