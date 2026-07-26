import "server-only";

import {
  callReleaseReservedBrandCredits,
  markSessionDeleted,
  markSessionFailed,
  type TryOnSessionRow,
} from "@/lib/try-on/sessions/service";
import {
  isSafePersonStoragePath,
  isSafeResultStoragePath,
} from "@/lib/try-on/sessions/paths";
import { removePersonPhoto, removeTryOnResult } from "@/lib/try-on/sessions/storage";
import { CLEANUP_BATCH_SIZE } from "@/lib/try-on/cleanup/constants";
import { storagePathBelongsToSession } from "@/lib/try-on/cleanup/path-guards";

export { CLEANUP_BATCH_SIZE } from "@/lib/try-on/cleanup/constants";
export { storagePathBelongsToSession } from "@/lib/try-on/cleanup/path-guards";

export async function removeSessionArtifacts(session: TryOnSessionRow): Promise<void> {
  if (session.person_storage_path && isSafePersonStoragePath(session.person_storage_path)) {
    if (storagePathBelongsToSession(session.person_storage_path, session)) {
      await removePersonPhoto(session.person_storage_path);
    }
  }

  if (session.result_storage_path && isSafeResultStoragePath(session.result_storage_path)) {
    if (storagePathBelongsToSession(session.result_storage_path, session)) {
      await removeTryOnResult(session.result_storage_path);
    }
  }
}

export async function cleanupExpiredSession(session: TryOnSessionRow): Promise<void> {
  switch (session.status) {
    case "pending_upload":
      await removeSessionArtifacts(session);
      await markSessionDeleted(session.id);
      return;

    case "queued":
    case "processing":
      await callReleaseReservedBrandCredits(session.id);
      await markSessionFailed(
        session.id,
        "SESSION_EXPIRED",
        "This try-on session expired before it could finish.",
      );
      await removeSessionArtifacts(session);
      await markSessionDeleted(session.id);
      return;

    case "failed":
    case "cancelled":
      if ((session.credit_cost ?? 0) > 0) {
        await callReleaseReservedBrandCredits(session.id);
      }

      await removeSessionArtifacts(session);
      await markSessionDeleted(session.id);
      return;

    case "completed":
      await removeSessionArtifacts(session);
      await markSessionDeleted(session.id);
      return;

    default:
      await removeSessionArtifacts(session);
      await markSessionDeleted(session.id);
  }
}
