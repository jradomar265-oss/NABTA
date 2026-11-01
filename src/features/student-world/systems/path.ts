import type { WorldPoint } from "../types";

export type PathSample = { x: number; y: number; angle: number };

/** Arc-length parameterised sample of the authored learning path. */
export function createPathSampler(points: WorldPoint[]) {
  const segments: { from: WorldPoint; to: WorldPoint; length: number; start: number }[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    segments.push({ from, to, length, start: total });
    total += length;
  }

  function sample(t: number): PathSample {
    const clamped = Math.min(1, Math.max(0, t));
    const target = clamped * total;
    let segment = segments[segments.length - 1];
    for (const candidate of segments) {
      if (target <= candidate.start + candidate.length) {
        segment = candidate;
        break;
      }
    }
    const local = segment.length === 0 ? 0 : (target - segment.start) / segment.length;
    return {
      x: segment.from.x + (segment.to.x - segment.from.x) * local,
      y: segment.from.y + (segment.to.y - segment.from.y) * local,
      angle: Math.atan2(segment.to.y - segment.from.y, segment.to.x - segment.from.x),
    };
  }

  /** Nearest path fraction for an arbitrary world point, used for click targets. */
  function nearestT(point: WorldPoint): number {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 200; i += 1) {
      const t = i / 200;
      const at = sample(t);
      const distance = Math.hypot(at.x - point.x, at.y - point.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = t;
      }
    }
    return best;
  }

  return { sample, nearestT, total };
}
