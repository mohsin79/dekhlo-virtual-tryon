import { notFound } from "next/navigation";
import Link from "next/link";
import { BrandCreditOperations } from "@/components/platform/brand-credit-operations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPlatformDateTime, formatPlatformTransactionType } from "@/lib/platform/format";
import { fetchPlatformBrandDetail } from "@/lib/platform/queries";
import { parseUuidParam } from "@/lib/platform/validation";

export const dynamic = "force-dynamic";

export default async function PlatformBrandDetailPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId: rawBrandId } = await params;
  const brandId = parseUuidParam(rawBrandId);

  if (!brandId) {
    notFound();
  }

  const brand = await fetchPlatformBrandDetail(brandId);

  if (!brand) {
    notFound();
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <Link href="/platform/brands" className="text-sm text-accent-700 underline">
          Back to brands
        </Link>
        <h1 className="font-heading text-3xl text-foreground">{brand.name}</h1>
        <p className="text-muted-foreground">{brand.slug}</p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Created", value: formatPlatformDateTime(brand.createdAt) },
          { label: "Active products", value: brand.activeProductCount },
          { label: "Completed try-ons", value: brand.completedTryOnCount },
          { label: "Failed try-ons", value: brand.failedTryOnCount },
          { label: "Granted", value: brand.grantedCredits },
          { label: "Reserved", value: brand.reservedCredits },
          { label: "Consumed", value: brand.consumedCredits },
          { label: "Available", value: brand.availableCredits },
        ].map((item) => (
          <Card key={item.label} className="border-border/80 bg-surface/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{item.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-heading text-xl text-foreground">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <BrandCreditOperations
        brandId={brand.id}
        availableCredits={brand.availableCredits}
        maxRevocableCredits={brand.maxRevocableCredits}
      />

      <div className="grid gap-8 lg:grid-cols-2">
        <Card className="border-border/80 bg-surface/80">
          <CardHeader>
            <CardTitle className="font-heading text-xl">Recent credit transactions</CardTitle>
          </CardHeader>
          <CardContent>
            {brand.transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transactions yet.</p>
            ) : (
              <ul className="divide-y divide-border/70">
                {brand.transactions.map((transaction) => (
                  <li key={transaction.id} className="py-3">
                    <p className="font-medium text-foreground">
                      {formatPlatformTransactionType(transaction.type)} · {transaction.amount}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatPlatformDateTime(transaction.createdAt)}
                    </p>
                    {transaction.metadataSummary ? (
                      <p className="text-sm text-muted-foreground">{transaction.metadataSummary}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-surface/80">
          <CardHeader>
            <CardTitle className="font-heading text-xl">Recent audit actions</CardTitle>
          </CardHeader>
          <CardContent>
            {brand.auditEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No audit entries for this brand yet.</p>
            ) : (
              <ul className="divide-y divide-border/70">
                {brand.auditEntries.map((entry) => (
                  <li key={entry.id} className="py-3">
                    <p className="font-medium text-foreground">{entry.action}</p>
                    <p className="text-sm text-muted-foreground">
                      {entry.actorName} · {formatPlatformDateTime(entry.createdAt)}
                    </p>
                    <p className="text-sm text-muted-foreground">{entry.reason}</p>
                    {entry.metadataSummary ? (
                      <p className="text-sm text-muted-foreground">{entry.metadataSummary}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
