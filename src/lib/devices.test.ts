import { describe, expect, it } from "vitest";
import { DEVICE_TOUCH_MS, describeDevice, deviceAction, listDevices, newDeviceId, pruneDevices } from "./devices";

const now = 1_800_000_000_000;
const entry = (lastSeen = now, name = "Chrome on Windows") => ({ name, createdAt: 1, lastSeen });

describe("deviceAction", () => {
  it("registers a device the server has never confirmed, whatever the map says", () => {
    expect(deviceAction(false, undefined, now)).toBe("register");
    expect(deviceAction(false, entry(), now)).toBe("register");
  });
  it("signs out a confirmed device whose entry is gone", () => {
    expect(deviceAction(true, undefined, now)).toBe("signOut");
  });
  it("treats a stub with no name as gone", () => {
    expect(deviceAction(true, { lastSeen: now }, now)).toBe("signOut");
    expect(deviceAction(true, { name: "", lastSeen: now }, now)).toBe("signOut");
  });
  it("leaves a listed, recently active device alone", () => {
    expect(deviceAction(true, entry(now - 1000), now)).toBe("none");
    expect(deviceAction(true, entry(now - DEVICE_TOUCH_MS), now)).toBe("none");
  });
  it("refreshes a stale last-active time", () => {
    expect(deviceAction(true, entry(now - DEVICE_TOUCH_MS - 1), now)).toBe("touch");
  });
});

describe("pruneDevices", () => {
  const map = { a: entry(10), b: entry(30), c: entry(20) };
  it("drops nothing while there's room", () => {
    expect(pruneDevices(map, "new", 4)).toEqual([]);
    expect(pruneDevices(map, "a", 3)).toEqual([]);
  });
  it("drops the longest-idle devices to make room, never the one being kept", () => {
    expect(pruneDevices(map, "new", 3)).toEqual(["a"]);
    expect(pruneDevices(map, "new", 2)).toEqual(["a", "c"]);
    expect(pruneDevices(map, "a", 2)).toEqual(["c"]);
  });
});

describe("listDevices", () => {
  it("puts this device first, then the most recently active, and hides stubs", () => {
    const map = { a: entry(10), b: entry(30), me: entry(5), stub: { lastSeen: 99 } as never };
    expect(listDevices(map, "me").map(d => d.id)).toEqual(["me", "b", "a"]);
    expect(listDevices(map, "me")[0].current).toBe(true);
  });
});

describe("describeDevice", () => {
  const win = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
  it("names the browser and the system", () => {
    expect(describeDevice(win, 0, false)).toBe("Chrome on Windows");
    expect(describeDevice(win + " Edg/126.0.0.0", 0, false)).toBe("Edge on Windows");
    expect(describeDevice("Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0", 0, false)).toBe("Firefox on Linux");
    expect(describeDevice(mac, 0, false)).toBe("Safari on Mac");
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", 5, false)).toBe("Safari on iPhone");
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36", 5, false)).toBe("Chrome on Android");
  });
  it("tells an iPad from a Mac by its touch screen", () => {
    expect(describeDevice(mac, 5, false)).toBe("Safari on iPad");
  });
  it("says so when it's the installed app", () => {
    expect(describeDevice(win, 0, true)).toBe("DuePlanner app on Windows");
  });
  it("copes with something unrecognised", () => {
    expect(describeDevice("", 0, false)).toBe("Browser on this device");
  });
});

describe("newDeviceId", () => {
  it("is letters and digits only, and different each time", () => {
    const a = newDeviceId(), b = newDeviceId();
    expect(a).toMatch(/^[0-9a-f]{24}$/);
    expect(a).not.toBe(b);
  });
});
