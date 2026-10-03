import { describe, it, expect } from "vitest";
import { ANIM_SPEED, clampSpeed, setAnimationSpeed, animationRate, scaledMs } from "./animSpeed";

describe("clampSpeed", () => {
  it("keeps values inside the slider's range", () => {
    expect(clampSpeed(1)).toBe(1);
    expect(clampSpeed(0.1)).toBe(ANIM_SPEED.min);
    expect(clampSpeed(9)).toBe(ANIM_SPEED.max);
  });
  it("falls back to normal speed for junk", () => {
    expect(clampSpeed("fast")).toBe(1);
    expect(clampSpeed(NaN)).toBe(1);
    expect(clampSpeed(undefined)).toBe(1);
  });
  it("accepts a numeric string (a legacy unquoted stored value)", () => {
    expect(clampSpeed("1.5")).toBe(1.5);
  });
});

describe("scaledMs", () => {
  it("shortens waits when faster and lengthens them when slower", () => {
    setAnimationSpeed(2);
    expect(animationRate()).toBe(2);
    expect(scaledMs(750)).toBe(375);
    setAnimationSpeed(0.5);
    expect(scaledMs(750)).toBe(1500);
    setAnimationSpeed(1);
    expect(scaledMs(750)).toBe(750);
  });
});
