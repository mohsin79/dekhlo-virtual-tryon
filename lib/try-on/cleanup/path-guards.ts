import type { TryOnSessionRow } from "@/lib/try-on/sessions/public-session";

export function storagePathBelongsToSession(path: string, session: TryOnSessionRow): boolean {
  const prefix = `${session.brand_id}/${session.id}/`;
  return path.startsWith(prefix);
}
