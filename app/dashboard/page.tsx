import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { requireUserContext } from "@/lib/auth/get-user-context";

function formatRole(role: string | null): string {
  if (!role) {
    return "Member";
  }

  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default async function DashboardPage() {
  const context = await requireUserContext("/dashboard");
  const brand = context.currentBrand?.brand;
  const displayName = context.profile.full_name?.trim() || "there";

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="font-heading text-3xl text-foreground">Welcome back, {displayName}</h1>
        <p className="max-w-2xl text-muted-foreground">
          Manage your brand workspace, catalog, and merchant settings from here.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/80 bg-surface/80">
          <CardHeader>
            <CardTitle className="font-heading text-xl">Brand workspace</CardTitle>
            <CardDescription>Live data from your authenticated membership.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="text-muted-foreground">Brand name</p>
              <p className="font-medium">{brand?.name}</p>
            </div>
            <Separator />
            <div>
              <p className="text-muted-foreground">Brand slug</p>
              <p className="font-medium">{brand?.slug}</p>
            </div>
            <Separator />
            <div>
              <p className="text-muted-foreground">Your role</p>
              <p className="font-medium">{formatRole(context.currentRole)}</p>
            </div>
            <Separator />
            <div>
              <p className="text-muted-foreground">Onboarding</p>
              <p className="font-medium">Complete</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-surface/80">
          <CardHeader>
            <CardTitle className="font-heading text-xl">Account</CardTitle>
            <CardDescription>Profile details loaded through row level security.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="text-muted-foreground">Full name</p>
              <p className="font-medium">{context.profile.full_name || "Not set"}</p>
            </div>
            <Separator />
            <div>
              <p className="text-muted-foreground">Email</p>
              <p className="font-medium">{context.email}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Alert>
        <AlertTitle>Catalog</AlertTitle>
        <AlertDescription>
          Product management is available from the Products section. Public try-on routes and session
          persistence arrive in later phases.
        </AlertDescription>
      </Alert>
    </div>
  );
}
