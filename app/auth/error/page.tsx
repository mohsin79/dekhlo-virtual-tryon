import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AuthErrorPage() {
  return (
    <Card className="border-border/80 bg-surface/80 shadow-md backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="font-heading text-2xl">Authentication link invalid</CardTitle>
        <CardDescription>
          This sign-in or recovery link is invalid, expired, or has already been used.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>Please request a new link and try again.</AlertDescription>
        </Alert>
        <div className="flex flex-wrap gap-3">
          <Link href="/auth/login" className="inline-flex">
            <Button type="button">Back to sign in</Button>
          </Link>
          <Link href="/auth/forgot-password" className="inline-flex">
            <Button type="button" variant="outline">
              Request password reset
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
