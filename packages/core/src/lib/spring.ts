// Physics behind the task detail sheet's drag: it follows the finger, then on
// release either springs back into place or flies off the bottom of the screen.
// Units are pixels and seconds throughout (velocity in px/s).

// One step of a damped spring pulling `pos` toward `target`. Integrated in
// small fixed substeps (semi-implicit Euler) so a long frame can't blow it up.
// zeta < 1 overshoots a little before settling, which is what reads as "springy".
export function stepSpring(pos: number, vel: number, target: number, dt: number, stiffness = 380, zeta = 0.72): { pos: number; vel: number } {
  const damping = 2 * Math.sqrt(stiffness) * zeta;
  let p = pos, v = vel, left = Math.min(dt, 0.1);
  while (left > 0) {
    const h = Math.min(left, 1 / 240);
    v += (-stiffness * (p - target) - damping * v) * h;
    p += v * h;
    left -= h;
  }
  return { pos: p, vel: v };
}

// Close enough to the target, and slow enough, to stop animating.
export function springSettled(pos: number, vel: number, target: number): boolean {
  return Math.abs(pos - target) < 0.5 && Math.abs(vel) < 10;
}

// Resistance for dragging past a limit (pulling the sheet up): the further you
// pull, the less it moves, approaching but never reaching `max` pixels.
export function rubberBand(overshoot: number, max = 60): number {
  if (overshoot <= 0) return 0;
  return max * (1 - 1 / (overshoot / max * 0.55 + 1));
}

// Finger velocity at release, from recent (time ms, y px) samples: the change
// over the last `windowMs`, so a finger that stopped before lifting reads ~0.
export function releaseVelocity(samples: { t: number; y: number }[], windowMs = 100): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[samples.length - 2];
  for (let i = samples.length - 2; i >= 0 && last.t - samples[i].t <= windowMs; i--) first = samples[i];
  const dt = last.t - first.t;
  return dt > 0 ? ((last.y - first.y) / dt) * 1000 : 0;
}

// Dismiss on a fast downward flick, or when dragged far enough and not being
// flicked back up.
export function shouldDismiss(offset: number, velocity: number, distance = 110): boolean {
  if (velocity > 700 && offset > 8) return true;
  return offset > distance && velocity > -250;
}
