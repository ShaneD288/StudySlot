import { describe, expect, it } from "vitest";
import { project, rubberband, stepSpring, velocityTracker } from "../public/lib/motion.js";

const run = (params, seconds = 2, velocity = 0) => {
  let state = { value: 0, velocity };
  const path = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    state = stepSpring(state, 100, 1 / 60, params);
    path.push(state.value);
  }
  return { state, path };
};

describe("springs", () => {
  it("a critically damped spring settles on its target without overshooting", () => {
    const { state, path } = run({ response: 0.4, damping: 1 });
    expect(state.value).toBeCloseTo(100, 1);
    expect(Math.max(...path)).toBeLessThanOrEqual(100.01);
  });

  it("a bouncier spring overshoots, then settles", () => {
    const { state, path } = run({ response: 0.4, damping: 0.6 });
    expect(Math.max(...path)).toBeGreaterThan(101);
    expect(state.value).toBeCloseTo(100, 1);
  });

  it("response is roughly how long it takes to get there", () => {
    const { path } = run({ response: 0.4, damping: 1 });
    const arrived = path.findIndex((v) => v > 95) / 60;
    expect(arrived).toBeGreaterThan(0.2);
    expect(arrived).toBeLessThan(0.6);
  });

  it("keeps the speed it starts with", () => {
    const flung = stepSpring({ value: 0, velocity: 2000 }, 0, 1 / 60);
    expect(flung.value).toBeGreaterThan(10);
  });
});

describe("gestures", () => {
  it("projects a flick the way scrolling decelerates", () => {
    expect(project(0)).toBe(0);
    expect(project(1000)).toBeCloseTo(499, 0);
    expect(project(-1000)).toBeCloseTo(-499, 0);
  });

  it("rubber-bands: follows less the further past the edge", () => {
    expect(rubberband(0, 500)).toBe(0);
    expect(rubberband(50, 500)).toBeLessThan(50);
    expect(rubberband(400, 500) / 400).toBeLessThan(rubberband(50, 500) / 50);
    expect(rubberband(10000, 500)).toBeLessThan(500);
  });

  it("measures pointer velocity from recent movement only", () => {
    const tracker = velocityTracker();
    tracker.add(0, 0);
    tracker.add(10, 10);
    tracker.add(20, 20);
    expect(tracker.velocity()).toBeCloseTo(1000);
    // The finger stopped for a while before lifting: no fling.
    tracker.add(20, 400);
    expect(Math.abs(tracker.velocity())).toBeLessThan(100);
  });
});
