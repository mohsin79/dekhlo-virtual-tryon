import type { TryOnSessionRow } from "@/lib/try-on/sessions/public-session";

export type LoadedSessionState =
  | { action: "skip"; reason: "completed" | "terminal" | "missing" | "expired" | "deleted" }
  | { action: "process"; session: TryOnSessionRow };

function isSessionExpired(session: TryOnSessionRow): boolean {
  return new Date(session.expires_at).getTime() <= Date.now();
}

function isSessionDeleted(session: TryOnSessionRow): boolean {
  return session.deleted_at != null;
}

export function evaluateSessionForGeneration(session: TryOnSessionRow | null): LoadedSessionState {
  if (!session) {
    return { action: "skip", reason: "missing" };
  }

  if (isSessionDeleted(session)) {
    return { action: "skip", reason: "deleted" };
  }

  if (isSessionExpired(session)) {
    return { action: "skip", reason: "expired" };
  }

  if (session.status === "completed") {
    return { action: "skip", reason: "completed" };
  }

  if (session.status === "failed" || session.status === "cancelled") {
    return { action: "skip", reason: "terminal" };
  }

  if (session.status !== "queued" && session.status !== "processing") {
    return { action: "skip", reason: "terminal" };
  }

  return { action: "process", session };
}
