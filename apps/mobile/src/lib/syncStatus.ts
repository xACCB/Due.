import { formatAgo } from "@dueplanner/core/lib/format";

// The web's syncStatus line, for Profile and the sidebar's top row: where this
// phone's changes stand. `offline` is useAppValue's: Firestore has only had
// its cache for a few seconds, so it can't reach the cloud.
export const OFFLINE_TEXT = "Offline. Changes will sync when you're back online";
export function syncStatusText(sync: { pending: boolean; syncedAt: number | null; offline?: boolean }, now: number): string {
  if (sync.offline) return OFFLINE_TEXT;
  if (sync.pending) return "Saving...";
  if (sync.syncedAt) return `Synced ${formatAgo(sync.syncedAt, now)}`;
  return "Connecting...";
}
