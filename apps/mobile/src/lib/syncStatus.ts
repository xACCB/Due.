import { formatAgo } from "@dueplanner/core/lib/format";

// The web's syncStatus line, for Profile and the sidebar's top row: where this
// phone's changes stand. (The web also says "Offline ..."; the phone doesn't
// watch the network yet, so offline shows as "Saving...".)
export function syncStatusText(sync: { pending: boolean; syncedAt: number | null }, now: number): string {
  if (sync.pending) return "Saving...";
  if (sync.syncedAt) return `Synced ${formatAgo(sync.syncedAt, now)}`;
  return "Connecting...";
}
