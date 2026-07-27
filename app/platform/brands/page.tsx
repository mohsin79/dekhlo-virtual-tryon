import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatPlatformDateTime } from "@/lib/platform/format";
import { fetchPlatformBrandList } from "@/lib/platform/queries";
import { parsePlatformPageParam, parsePlatformSearchParam } from "@/lib/platform/validation";

export const dynamic = "force-dynamic";

function buildBrandsHref(page: number, search: string): string {
  const params = new URLSearchParams();

  if (page > 1) {
    params.set("page", String(page));
  }

  if (search) {
    params.set("q", search);
  }

  const query = params.toString();
  return query ? `/platform/brands?${query}` : "/platform/brands";
}

export default async function PlatformBrandsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const params = await searchParams;
  const page = parsePlatformPageParam(params.page);
  const search = parsePlatformSearchParam(params.q);
  const { brands, total, pageSize } = await fetchPlatformBrandList({ page, search });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="font-heading text-3xl text-foreground">Brands</h1>
        <p className="max-w-2xl text-muted-foreground">
          Search and review tenant brands with catalog and credit snapshots.
        </p>
      </section>

      <form method="get" className="flex max-w-xl flex-col gap-3 sm:flex-row">
        <Input name="q" defaultValue={search} placeholder="Search by name or slug" maxLength={100} />
        <Button type="submit">Search</Button>
      </form>

      <Card className="border-border/80 bg-surface/80">
        <CardHeader>
          <CardTitle className="font-heading text-xl">Brand directory</CardTitle>
        </CardHeader>
        <CardContent>
          {brands.length === 0 ? (
            <p className="text-sm text-muted-foreground">No brands match this view.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-border/70 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Brand</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                    <th className="px-3 py-2 font-medium">Products</th>
                    <th className="px-3 py-2 font-medium">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {brands.map((brand) => (
                    <tr key={brand.id} className="border-b border-border/50">
                      <td className="px-3 py-3">
                        <Link href={`/platform/brands/${brand.id}`} className="font-medium text-accent-700">
                          {brand.name}
                        </Link>
                        <p className="text-muted-foreground">{brand.slug}</p>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {formatPlatformDateTime(brand.createdAt)}
                      </td>
                      <td className="px-3 py-3">{brand.activeProductCount}</td>
                      <td className="px-3 py-3">{brand.availableCredits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 ? (
            <div className="mt-6 flex items-center justify-between text-sm">
              <p className="text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                {page > 1 ? (
                  <Link href={buildBrandsHref(page - 1, search)} className="underline">
                    Previous
                  </Link>
                ) : null}
                {page < totalPages ? (
                  <Link href={buildBrandsHref(page + 1, search)} className="underline">
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
