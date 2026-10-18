import { describe, it, expect } from "vitest";
import { stepSpring, springSettled, rubberBand, releaseVelocity, shouldDismiss } from "./spring";

describe("stepSpring", () => {
  it("settles at the target, overshooting a little on the way", () => {
    let s = { pos: 200, vel: 0 };
    let minPos = Infinity;
    for (let i = 0; i < 120 && !springSettled(s.pos, s.vel, 0); i++) {
      s = stepSpring(s.pos, s.vel, 0, 1 / 60);
      minPos = Math.min(minPos, s.pos);
    }
    expect(springSettled(s.pos, s.vel, 0)).toBe(true);
    expect(minPos).toBeLessThan(0); // springy, not a plain ease
    expect(minPos).toBeGreaterThan(-20); // but only slightly
  });
  it("carries release velocity", () => {
    const still = stepSpring(50, 0, 0, 1 / 60);
    const flung = stepSpring(50, 1500, 0, 1 / 60);
    expect(flung.pos).toBeGreaterThan(still.pos);
  });
  it("stays stable over a very long frame", () => {
    const s = stepSpring(300, 0, 0, 5);
    expect(Number.isFinite(s.pos)).toBe(true);
    expect(Math.abs(s.pos)).toBeLessThan(300);
  });
});

describe("rubberBand", () => {
  it("resists more the further you pull, never passing the max", () => {
    expect(rubberBand(0)).toBe(0);
    expect(rubberBand(-10)).toBe(0);
    const a = rubberBand(20), b = rubberBand(200), c = rubberBand(5000);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(20);
    expect(b).toBeGreaterThan(a);
    expect(b - a).toBeLessThan(180);
    expect(c).toBeLessThan(60);
  });
});

describe("releaseVelocity", () => {
  it("measures px/s over the recent window", () => {
    expect(releaseVelocity([])).toBe(0);
    expect(releaseVelocity([{ t: 0, y: 0 }])).toBe(0);
    expect(releaseVelocity([{ t: 0, y: 0 }, { t: 50, y: 50 }, { t: 100, y: 100 }])).toBeCloseTo(1000);
  });
  it("ignores old movement when the finger paused before lifting", () => {
    const v = releaseVelocity([{ t: 0, y: 0 }, { t: 50, y: 200 }, { t: 400, y: 200 }, { t: 450, y: 200 }]);
    expect(v).toBe(0);
  });
});

describe("shouldDismiss", () => {
  it("dismisses on a fast flick or a long drag", () => {
    expect(shouldDismiss(20, 1200)).toBe(true);
    expect(shouldDismiss(150, 0)).toBe(true);
  });
  it("springs back on a short slow drag or a flick back up", () => {
    expect(shouldDismiss(40, 100)).toBe(false);
    expect(shouldDismiss(150, -600)).toBe(false);
    expect(shouldDismiss(0, 2000)).toBe(false);
  });
});
