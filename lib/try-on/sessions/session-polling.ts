import type { Database } from "@/lib/supabase/database.types";

export type TryOnSessionStatus = Database["public"]["Enums"]["try_on_session_status"];

const POLLING_STATUSES: TryOnSessionStatus[] = ["queued", "processing"];

export function shouldContinueSessionPolling(status: TryOnSessionStatus): boolean {
  return POLLING_STATUSES.includes(status);
}

export function computeSessionPollDelayMs(pollAttempt: number): number {
  const initialDelayMs = 1000;
  const maxDelayMs = 5000;
  const delay = initialDelayMs + pollAttempt * 500;
  return Math.min(maxDelayMs, delay);
}

export function isTerminalPollStatus(status: TryOnSessionStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
