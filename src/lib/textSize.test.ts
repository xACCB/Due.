import { describe, expect, it } from "vitest";
import { TEXT_SIZES, fz, scaledPx, share, textSizeOf } from "./textSize";

describe("textSizeOf", () => {
  it("keeps a saved choice and falls back to the default for anything else", () => {
    expect(textSizeOf("small")).toBe("small");
    expect(textSizeOf("large")).toBe("large");
    for (const bad of [undefined, null, "", "huge", 2, "toString"]) expect(textSizeOf(bad)).toBe("default");
  });
});

describe("share", () => {
  it("is everything for small text, nothing from 20px, and tapers between", () => {
    expect(share(9)).toBe(1);
    expect(share(12)).toBe(1);
    expect(share(16)).toBe(0.5);
    expect(share(20)).toBe(0);
    expect(share(52)).toBe(0);
  });
});

describe("scaledPx", () => {
  it("leaves every size alone on Small", () => {
    for (const px of [8, 10, 12, 15, 22, 116]) expect(scaledPx(px, "small")).toBe(px);
  });
  it("makes small text bigger and leaves large text alone", () => {
    expect(scaledPx(10, "default")).toBeCloseTo(11.5);
    expect(scaledPx(12, "default")).toBeCloseTo(13.8);
    expect(scaledPx(12, "large")).toBeCloseTo(15.6);
    expect(scaledPx(22, "large")).toBe(22);
  });
  it("never puts a smaller size above a larger one", () => {
    for (const size of Object.keys(TEXT_SIZES) as (keyof typeof TEXT_SIZES)[]) {
      for (let px = 8; px < 60; px++) expect(scaledPx(px + 1, size)).toBeGreaterThan(scaledPx(px, size));
    }
  });
});

describe("fz", () => {
  it("is a calc on --ts for text that grows, with the default as its fallback", () => {
    expect(fz(10)).toBe("calc(10px + 10px * var(--ts, 0.15))");
    expect(fz(16)).toBe("calc(16px + 8px * var(--ts, 0.15))");
  });
  it("is the plain number for text that doesn't", () => {
    expect(fz(20)).toBe(20);
    expect(fz(52)).toBe(52);
  });
});
