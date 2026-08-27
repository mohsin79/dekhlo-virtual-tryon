import type { AnalyticsEventName } from "@/lib/analytics/events";

const PENDING_PREFIX = "dekhlo-analytics-pending:";
const memoryStore = new Map<string, string>();

function readPendingValue(key: string): string | null {
  if (typeof sessionStorage !== "undefined") {
    return sessionStorage.getItem(key);
  }

  return memoryStore.get(key) ?? null;
}

function writePendingValue(key: string, value: string): void {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(key, value);
    return;
  }

  memoryStore.set(key, value);
}

function deletePendingValue(key: string): void {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(key);
    return;
  }

  memoryStore.delete(key);
}

export function markPendingAnalyticsEvent(event: AnalyticsEventName): void {
  writePendingValue(`${PENDING_PREFIX}${event}`, "1");
}

export function consumePendingAnalyticsEvent(event: AnalyticsEventName): boolean {
  const key = `${PENDING_PREFIX}${event}`;
  const value = readPendingValue(key);

  if (value !== "1") {
    return false;
  }

  deletePendingValue(key);
  return true;
}

export function __clearPendingAnalyticsEventsForTests(): void {
  for (const event of [
    "signup_started",
    "signup_completed",
    "brand_created",
    "product_created",
  ] as const) {
    deletePendingValue(`${PENDING_PREFIX}${event}`);
  }
}
