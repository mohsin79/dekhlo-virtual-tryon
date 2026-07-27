import { LEAD_FORM_DISMISS_PREFIX } from "@/lib/leads/constants";

export function leadFormDismissStorageKey(sessionId: string): string {
  return `${LEAD_FORM_DISMISS_PREFIX}${sessionId}`;
}

export function readLeadFormDismissed(sessionId: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.sessionStorage.getItem(leadFormDismissStorageKey(sessionId)) === "1";
  } catch {
    return false;
  }
}

export function writeLeadFormDismissed(sessionId: string, dismissed: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const key = leadFormDismissStorageKey(sessionId);

    if (dismissed) {
      window.sessionStorage.setItem(key, "1");
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore storage failures.
  }
}
