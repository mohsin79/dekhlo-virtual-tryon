import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  authErrorMessage,
  authErrorTitle,
  parseAuthErrorReason,
} from "@/lib/auth/auth-error-reason";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const params = await searchParams;
  const reason = parseAuthErrorReason(params.reason);
  const title = authErrorTitle(reason);
  const message = authErrorMessage(reason);

  return (
    <Card className="border-border/80 bg-surface/80 shadow-md backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="font-heading text-2xl">{title}</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription>
            If you were confirming a new account, sign in first before requesting another link.
          </AlertDescription>
        </Alert>
        <div className="flex flex-wrap gap-3">
          <Link href="/auth/login" className="inline-flex">
            <Button type="button">Sign in</Button>
          </Link>
          <Link href="/auth/sign-up" className="inline-flex">
            <Button type="button" variant="outline">
              Create account
            </Button>
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Forgot your password?{" "}
          <Link href="/auth/forgot-password" className="text-accent hover:text-accent-700">
            Request a password reset
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
