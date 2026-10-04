import { redirect } from "next/navigation";
import { ConfirmCallbackForm } from "@/components/auth/confirm-callback-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authErrorPath } from "@/lib/auth/auth-error-reason";

export default async function AuthConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; code?: string; next?: string }>;
}) {
  const params = await searchParams;
  const tokenHash = params.token_hash?.trim() ?? "";
  const type = params.type?.trim() ?? "";
  const code = params.code?.trim() ?? "";
  const nextPath = params.next?.trim() ?? "";

  if (!tokenHash && !code) {
    redirect(authErrorPath("missing_callback"));
  }

  const isRecovery = type === "recovery";

  return (
    <Card className="border-border/80 bg-surface/80 shadow-md backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="font-heading text-2xl">
          {isRecovery ? "Reset your password" : "Confirm your email"}
        </CardTitle>
        <CardDescription>
          {isRecovery
            ? "Email security tools sometimes open links automatically. Click continue to finish resetting your password. Opening this page does not use the link."
            : "Email security tools sometimes open links automatically. Click confirm to activate your account. Opening this page does not use the link."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ConfirmCallbackForm
          tokenHash={tokenHash}
          type={type}
          code={code}
          nextPath={nextPath}
          buttonLabel={isRecovery ? "Continue to reset password" : "Confirm email"}
        />
      </CardContent>
    </Card>
  );
}
