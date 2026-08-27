import Link from "next/link";
import { LeadsDashboardAnalytics } from "@/components/analytics/analytics-event-hooks";
import { LeadsFilters } from "@/components/leads/leads-filters";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserContext } from "@/lib/auth/get-user-context";
import { buildLeadMailtoLink, buildLeadTelLink } from "@/lib/leads/contact-links";
import { parseLeadsDashboardFilters } from "@/lib/leads/dashboard-params";
import { canViewLeads } from "@/lib/leads/permissions";
import { fetchBrandLeads, fetchLeadProductFilterOptions } from "@/lib/leads/queries";

export const dynamic = "force-dynamic";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function buildLeadsHref(filters: ReturnType<typeof parseLeadsDashboardFilters>, page: number): string {
  const params = new URLSearchParams();

  if (filters.search) params.set("q", filters.search);
  if (filters.productId) params.set("productId", filters.productId);
  if (filters.startDate) params.set("start", filters.startDate);
  if (filters.endDate) params.set("end", filters.endDate);
  if (page > 1) params.set("page", String(page));

  const query = params.toString();
  return query ? `/dashboard/leads?${query}` : "/dashboard/leads";
}

type PageProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
    productId?: string;
    start?: string;
    end?: string;
  }>;
};

export default async function LeadsPage({ searchParams }: PageProps) {
  const context = await requireUserContext("/dashboard/leads");

  if (!context.currentBrand) {
    return null;
  }

  if (!canViewLeads(context.currentRole)) {
    return (
      <div className="space-y-6">
        <section className="space-y-2">
          <h1 className="font-heading text-3xl text-foreground">Leads</h1>
          <p className="max-w-2xl text-muted-foreground">
            Try-on lead contact details are not available for your role.
          </p>
        </section>
        <Card className="border-border/80 bg-surface/80">
          <CardHeader>
            <CardTitle className="font-heading text-xl">Access unavailable</CardTitle>
            <CardDescription>
              Only brand owners and admins can view shopper contact details submitted after try-on.
              Editors and analysts cannot access lead records.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const rawParams = await searchParams;
  const filters = parseLeadsDashboardFilters(rawParams);
  const brandId = context.currentBrand.brandId;

  const [result, productOptions] = await Promise.all([
    fetchBrandLeads(brandId, filters),
    fetchLeadProductFilterOptions(brandId),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.totalCount / result.pageSize));
  const hasFilters =
    filters.search.length > 0 ||
    filters.productId != null ||
    filters.startDate != null ||
    filters.endDate != null;

  return (
    <div className="space-y-8">
      <LeadsDashboardAnalytics />
      <section className="space-y-2">
        <h1 className="font-heading text-3xl text-foreground">Leads</h1>
        <p className="max-w-2xl text-muted-foreground">
          Optional shopper contact details submitted after virtual try-on on{" "}
          {context.currentBrand.brand.name}. Read-only — no export, editing, or deletion in this
          release.
        </p>
        <p className="text-sm text-muted-foreground">
          {result.totalCount} matching lead{result.totalCount === 1 ? "" : "s"}
        </p>
      </section>

      <LeadsFilters
        search={filters.search}
        productId={filters.productId}
        startDate={filters.startDate}
        endDate={filters.endDate}
        products={productOptions}
      />

      {result.totalCount === 0 ? (
        <Card className="border-border/80 bg-surface/80">
          <CardHeader>
            <CardTitle className="font-heading text-xl">
              {hasFilters ? "No matching leads" : "No leads yet"}
            </CardTitle>
            <CardDescription>
              {hasFilters
                ? "Try adjusting your search or filters."
                : "Leads appear here when shoppers optionally share contact details after a completed try-on."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/70">
          <table className="min-w-full divide-y divide-border/70 text-sm">
            <thead className="bg-surface/80 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Marketing</th>
                <th className="px-4 py-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70 bg-background/40">
              {result.rows.map((lead) => {
                const mailto = buildLeadMailtoLink(lead.email);
                const tel = buildLeadTelLink(lead.phone);

                return (
                  <tr key={lead.id}>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(lead.createdAt)}</td>
                    <td className="px-4 py-3">{lead.fullName ?? "—"}</td>
                    <td className="px-4 py-3">
                      <a href={mailto} className="text-accent-700 underline">
                        {lead.email}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      {lead.phone ? (
                        tel ? (
                          <a href={tel} className="text-accent-700 underline">
                            {lead.phone}
                          </a>
                        ) : (
                          lead.phone
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">{lead.productLabel}</td>
                    <td className="px-4 py-3">{lead.consentToContact ? "Yes" : "No"}</td>
                    <td className="px-4 py-3">{lead.consentToMarketing ? "Yes" : "No"}</td>
                    <td className="px-4 py-3">{lead.source}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 ? (
        <nav className="flex flex-wrap items-center gap-3 text-sm" aria-label="Leads pagination">
          {result.page > 1 ? (
            <Link className="btn btn-secondary" href={buildLeadsHref(filters, result.page - 1)}>
              Previous
            </Link>
          ) : null}
          <span className="text-muted-foreground">
            Page {result.page} of {totalPages}
          </span>
          {result.page < totalPages ? (
            <Link className="btn btn-secondary" href={buildLeadsHref(filters, result.page + 1)}>
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
