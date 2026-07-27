import { z } from "zod";
import {
  LEADS_MAX_DATE_RANGE_DAYS,
  LEADS_MAX_PAGE,
  LEADS_MAX_SEARCH_LENGTH,
  LEADS_PAGE_SIZE,
} from "@/lib/leads/constants";

export type LeadsDashboardFilters = {
  page: number;
  search: string;
  productId: string | null;
  startDate: string | null;
  endDate: string | null;
};

export function escapeLeadSearchPattern(input: string): string {
  return input.replace(/[%_\\]/g, "\\$&");
}

export function parseLeadsPageParam(raw: string | undefined): number {
  if (!raw) {
    return 1;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  return Math.min(parsed, LEADS_MAX_PAGE);
}

export function parseLeadsSearchParam(raw: string | undefined): string {
  if (!raw) {
    return "";
  }

  return raw.trim().replace(/,/g, " ").slice(0, LEADS_MAX_SEARCH_LENGTH);
}

export function parseLeadsProductIdParam(raw: string | undefined): string | null {
  if (!raw?.trim()) {
    return null;
  }

  const parsed = z.string().uuid().safeParse(raw.trim());
  return parsed.success ? parsed.data : null;
}

function parseDateOnly(raw: string | undefined): string | null {
  if (!raw?.trim()) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());

  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1] ?? "0", 10);
  const month = Number.parseInt(match[2] ?? "0", 10);
  const day = Number.parseInt(match[3] ?? "0", 10);
  const utc = Date.UTC(year, month - 1, day);

  if (Number.isNaN(utc)) {
    return null;
  }

  const check = new Date(utc);

  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseLeadsDashboardFilters(input: {
  page?: string;
  q?: string;
  productId?: string;
  start?: string;
  end?: string;
}): LeadsDashboardFilters {
  let startDate = parseDateOnly(input.start);
  let endDate = parseDateOnly(input.end);

  if (startDate && endDate && startDate > endDate) {
    const swap = startDate;
    startDate = endDate;
    endDate = swap;
  }

  if (startDate && endDate) {
    const startMs = Date.parse(`${startDate}T00:00:00.000Z`);
    const endMs = Date.parse(`${endDate}T00:00:00.000Z`);
    const spanDays = Math.floor((endMs - startMs) / (24 * 60 * 60 * 1000));

    if (spanDays > LEADS_MAX_DATE_RANGE_DAYS) {
      endDate = null;
    }
  }

  return {
    page: parseLeadsPageParam(input.page),
    search: parseLeadsSearchParam(input.q),
    productId: parseLeadsProductIdParam(input.productId),
    startDate,
    endDate,
  };
}

export function leadsDateRangeToIsoBounds(filters: LeadsDashboardFilters): {
  startIso: string | null;
  endIso: string | null;
} {
  if (!filters.startDate && !filters.endDate) {
    return { startIso: null, endIso: null };
  }

  const startIso = filters.startDate ? `${filters.startDate}T00:00:00.000Z` : null;
  const endIso = filters.endDate ? `${filters.endDate}T23:59:59.999Z` : null;

  return { startIso, endIso };
}

export { LEADS_PAGE_SIZE };
