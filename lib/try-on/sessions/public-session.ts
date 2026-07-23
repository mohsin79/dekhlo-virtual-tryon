import type { Database } from "@/lib/supabase/database.types";

export type TryOnSessionRow = Database["public"]["Tables"]["try_on_sessions"]["Row"];

export function toPublicSessionStatus(session: TryOnSessionRow) {
  return {
    sessionId: session.id,
    status: session.status,
    errorCode: session.error_code,
    sanitizedErrorMessage: session.sanitized_error_message,
    expiresAt: session.expires_at,
    completedAt: session.completed_at,
  };
}
