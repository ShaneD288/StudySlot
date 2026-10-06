// Motion that behaves like real objects, after Apple's "Designing Fluid Interfaces" (WWDC 2018).
// Springs start from wherever a thing is now, at whatever speed it's moving, so they can be
// grabbed and redirected mid-flight. Units are px and seconds.

/**
 * One step of a spring towards `to`. `response` is roughly how long (s) the value takes to get
 * there; `damping` is how much it bounces (1 = settles without overshoot, lower = bouncier).
 */
export function stepSpring({ value, velocity }, to, dt, { response = 0.4, damping = 1 } = {}) {
  const stiffness = ((2 * Math.PI) / response) ** 2;
  const friction = (4 * Math.PI * damping) / response;
  // Small fixed sub-steps keep the spring stable whatever the frame rate.
  for (let left = dt; left > 0; left -= 1 / 240) {
    const h = Math.min(left, 1 / 240);
    velocity += (-stiffness * (value - to) - friction * velocity) * h;
    value += velocity * h;
  }
  return { value, velocity };
}

/**
 * Animates from `from` to `to` on each display frame. Returns { stop }, which halts the spring
 * and returns its current { value, velocity }.
 */
export function spring({ from, to, velocity = 0, response, damping, onUpdate, onDone }) {
  let state = { value: from, velocity };
  let last = null;
  let frame = requestAnimationFrame(function tick(now) {
    const dt = last == null ? 1 / 60 : Math.min((now - last) / 1000, 1 / 20);
    last = now;
    state = stepSpring(state, to, dt, { response, damping });
    if (Math.abs(state.velocity) < 2 && Math.abs(state.value - to) < 0.5) {
      state = { value: to, velocity: 0 };
      frame = null;
      onUpdate(to);
      onDone?.();
      return;
    }
    onUpdate(state.value);
    frame = requestAnimationFrame(tick);
  });
  return {
    stop() {
      if (frame != null) cancelAnimationFrame(frame);
      frame = null;
      return state;
    },
  };
}

/** How far a flick at `velocity` (px/s) would carry something, like a scroll view decelerating. */
export const project = (velocity, decelerationRate = 0.998) =>
  ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);

/** Past an edge, things follow the finger less and less the further they're pulled. */
export const rubberband = (overshoot, dimension, constant = 0.55) =>
  (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));

/** Velocity (px/s) of a pointer from its last 100ms of positions. */
export function velocityTracker() {
  const samples = [];
  return {
    add(position, time) {
      samples.push({ position, time });
      while (samples.length > 2 && time - samples[0].time > 100) samples.shift();
    },
    velocity() {
      if (samples.length < 2) return 0;
      const first = samples[0];
      const last = samples.at(-1);
      const dt = last.time - first.time;
      return dt > 0 ? ((last.position - first.position) / dt) * 1000 : 0;
    },
  };
}
