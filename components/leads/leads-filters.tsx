"use client";

import { useRouter } from "next/navigation";
import type { LeadProductFilterOption } from "@/lib/leads/queries";

type LeadsFiltersProps = {
  search: string;
  productId: string | null;
  startDate: string | null;
  endDate: string | null;
  products: LeadProductFilterOption[];
};

export function LeadsFilters({ search, productId, startDate, endDate, products }: LeadsFiltersProps) {
  const router = useRouter();

  return (
    <form
      className="grid gap-4 rounded-xl border border-border/70 bg-surface/60 p-4 md:grid-cols-2 xl:grid-cols-5"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const params = new URLSearchParams();

        const q = String(formData.get("q") ?? "").trim();
        const product = String(formData.get("productId") ?? "").trim();
        const start = String(formData.get("start") ?? "").trim();
        const end = String(formData.get("end") ?? "").trim();

        if (q) params.set("q", q);
        if (product) params.set("productId", product);
        if (start) params.set("start", start);
        if (end) params.set("end", end);

        const query = params.toString();
        router.push(query ? `/dashboard/leads?${query}` : "/dashboard/leads");
      }}
    >
      <div className="space-y-1 xl:col-span-2">
        <label className="text-sm font-medium" htmlFor="leads-search">
          Search
        </label>
        <input
          id="leads-search"
          name="q"
          type="search"
          defaultValue={search}
          maxLength={100}
          placeholder="Email, name, or phone"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="leads-product">
          Product
        </label>
        <select
          id="leads-product"
          name="productId"
          defaultValue={productId ?? ""}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">All products</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="leads-start">
          From
        </label>
        <input
          id="leads-start"
          name="start"
          type="date"
          defaultValue={startDate ?? ""}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="leads-end">
          To
        </label>
        <input
          id="leads-end"
          name="end"
          type="date"
          defaultValue={endDate ?? ""}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-wrap items-end gap-2 xl:col-span-5">
        <button type="submit" className="btn btn-primary">
          Apply filters
        </button>
        <a href="/dashboard/leads" className="btn btn-secondary">
          Clear filters
        </a>
      </div>
    </form>
  );
}
