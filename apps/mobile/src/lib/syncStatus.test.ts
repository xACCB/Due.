import { describe, expect, it } from "vitest";
import { OFFLINE_TEXT, syncStatusText } from "./syncStatus";

const now = 1_800_000_000_000;

describe("syncStatusText", () => {
  it("says offline first, whatever else is true", () => {
    expect(syncStatusText({ pending: true, syncedAt: now, offline: true }, now)).toBe(OFFLINE_TEXT);
  });

  it("says Saving while a write waits for the server", () => {
    expect(syncStatusText({ pending: true, syncedAt: now - 60_000 }, now)).toBe("Saving...");
  });

  it("says when it last synced", () => {
    expect(syncStatusText({ pending: false, syncedAt: now - 10_000 }, now)).toBe("Synced just now");
    expect(syncStatusText({ pending: false, syncedAt: now - 5 * 60_000 }, now)).toBe("Synced 5m ago");
    expect(syncStatusText({ pending: false, syncedAt: now - 3 * 3_600_000 }, now)).toBe("Synced 3h ago");
  });

  it("says Connecting before the first server reply", () => {
    expect(syncStatusText({ pending: false, syncedAt: null }, now)).toBe("Connecting...");
  });
});
