import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PLATFORM_AUDIT_ACTIONS } from "@/lib/platform/constants";
import { formatPlatformDateTime } from "@/lib/platform/format";
import { fetchPlatformAuditList, fetchPlatformBrandOptions } from "@/lib/platform/queries";
import { parsePlatformPageParam, parseUuidParam } from "@/lib/platform/validation";

export const dynamic = "force-dynamic";

function buildAuditHref(options: {
  page: number;
  action: string;
  brandId: string;
}): string {
  const params = new URLSearchParams();

  if (options.page > 1) {
    params.set("page", String(options.page));
  }

  if (options.action) {
    params.set("action", options.action);
  }

  if (options.brandId) {
    params.set("brandId", options.brandId);
  }

  const query = params.toString();
  return query ? `/platform/audit?${query}` : "/platform/audit";
}

export default async function PlatformAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; action?: string; brandId?: string }>;
}) {
  const params = await searchParams;
  const page = parsePlatformPageParam(params.page);
  const action =
    params.action && (PLATFORM_AUDIT_ACTIONS as readonly string[]).includes(params.action)
      ? params.action
      : "";
  const brandId = params.brandId ? parseUuidParam(params.brandId) ?? "" : "";
  const [{ entries, total, pageSize }, brandOptions] = await Promise.all([
    fetchPlatformAuditList({ page, action, brandId }),
    fetchPlatformBrandOptions(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="font-heading text-3xl text-foreground">Audit log</h1>
        <p className="max-w-2xl text-muted-foreground">
          Platform administrator credit operations with allowlisted metadata summaries.
        </p>
      </section>

      <form method="get" className="grid max-w-3xl gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Action</span>
          <select
            name="action"
            defaultValue={action}
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
          >
            <option value="">All actions</option>
            {PLATFORM_AUDIT_ACTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Brand</span>
          <select
            name="brandId"
            defaultValue={brandId}
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
          >
            <option value="">All brands</option>
            {brandOptions.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <Button type="submit" className="w-full sm:w-auto">
            Apply filters
          </Button>
        </div>
      </form>

      <Card className="border-border/80 bg-surface/80">
        <CardHeader>
          <CardTitle className="font-heading text-xl">Audit entries</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No audit entries match these filters.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {entries.map((entry) => (
                <li key={entry.id} className="py-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium text-foreground">{entry.action}</p>
                      <p className="text-sm text-muted-foreground">
                        {entry.brandName ?? "No brand"} · {entry.actorName}
                      </p>
                      <p className="text-sm text-muted-foreground">{entry.reason}</p>
                      {entry.targetType ? (
                        <p className="text-sm text-muted-foreground">
                          Target: {entry.targetType}
                          {entry.targetId ? ` · ${entry.targetId}` : ""}
                        </p>
                      ) : null}
                      {entry.metadataSummary ? (
                        <p className="text-sm text-muted-foreground">{entry.metadataSummary}</p>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {formatPlatformDateTime(entry.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 ? (
            <div className="mt-6 flex items-center justify-between text-sm">
              <p className="text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                {page > 1 ? (
                  <Link href={buildAuditHref({ page: page - 1, action, brandId })} className="underline">
                    Previous
                  </Link>
                ) : null}
                {page < totalPages ? (
                  <Link href={buildAuditHref({ page: page + 1, action, brandId })} className="underline">
                    Next
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
