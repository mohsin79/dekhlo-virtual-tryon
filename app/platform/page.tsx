import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPlatformDateTime } from "@/lib/platform/format";
import { fetchPlatformOverview } from "@/lib/platform/queries";

export const dynamic = "force-dynamic";

export default async function PlatformOverviewPage() {
  const { stats, recentAudit } = await fetchPlatformOverview();

  const statCards = [
    { label: "Total brands", value: stats.totalBrands },
    { label: "Active products", value: stats.totalActiveProducts },
    { label: "Completed try-ons", value: stats.completedTryOns },
    { label: "Failed try-ons", value: stats.failedTryOns },
    { label: "Granted credits", value: stats.grantedCredits },
    { label: "Reserved credits", value: stats.reservedCredits },
    { label: "Consumed credits", value: stats.consumedCredits },
    { label: "Available credits", value: stats.availableCredits },
  ];

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="font-heading text-3xl text-foreground">Overview</h1>
        <p className="max-w-2xl text-muted-foreground">
          Platform-wide aggregates for brands, catalog activity, try-on outcomes, and credit balances.
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => (
          <Card key={card.label} className="border-border/80 bg-surface/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-heading text-2xl text-foreground">{card.value.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/80 bg-surface/80">
        <CardHeader>
          <CardTitle className="font-heading text-xl">Recent platform audit actions</CardTitle>
        </CardHeader>
        <CardContent>
          {recentAudit.length === 0 ? (
            <p className="text-sm text-muted-foreground">No admin credit audit entries yet.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {recentAudit.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-foreground">{entry.action}</p>
                    <p className="text-sm text-muted-foreground">
                      {entry.brandName ?? "Unknown brand"} · {entry.actorName}
                    </p>
                    <p className="text-sm text-muted-foreground">{entry.reason}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">{formatPlatformDateTime(entry.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
