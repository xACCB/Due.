import { describe, expect, it } from "vitest";
import { FLAG_DEFAULTS, getFlags, readFlags } from "./flags";

describe("flags", () => {
  it("start from the defaults", () => {
    expect(getFlags()).toEqual(FLAG_DEFAULTS);
  });
  it("read a remote boolean, keeping the default for anything else", () => {
    expect(readFlags(k => (k === "devicesAutoSignOut" ? "false" : undefined)).devicesAutoSignOut).toBe(false);
    expect(readFlags(() => "maybe").devicesAutoSignOut).toBe(FLAG_DEFAULTS.devicesAutoSignOut);
    expect(readFlags(() => undefined)).toEqual(FLAG_DEFAULTS);
  });
});
