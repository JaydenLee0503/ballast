/**
 * Where the cracks go.
 *
 * Pure, seeded and deterministic: the same storey cracks in the same places
 * every time it is run, on every machine. That matters more than it looks like
 * it should — a student who runs the same storm twice and gets a differently
 * broken building learns that the picture is decorative, and stops trusting the
 * parts of it that are not.
 *
 * WHAT THIS DOES NOT DECIDE. Not *whether* a storey cracks, and not how badly:
 * that is `DamageState`, banded by the engine from the storey's own
 * utilisation. This module is handed a count and a seed and lays out polylines.
 * It is the same division `scenery.ts` keeps — geometry here, meaning there.
 *
 * COORDINATES. Cracks are generated in a normalised (u, v) space: `u` runs
 * around the storey's perimeter from 0 to 1, `v` up its height from 0 to 1.
 * The same space `windows.ts` sets panes out in, and for the same reason — it
 * is the one description of a wall that works for a rectangle and for an
 * ellipse, so a round storey cracks without a second implementation.
 */

export interface CrackPoint {
  /** Around the perimeter, 0..1. Wraps. */
  u: number
  /** Up the storey, 0..1. */
  v: number
}

/** One crack: a polyline of 3 to 5 points, to be drawn as line segments. */
export type Crack = CrackPoint[]

/**
 * Mulberry32. Small, fast, and — the only property that matters here — the
 * same sequence from the same seed in every JavaScript engine, which
 * `Math.random` deliberately is not.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** How far a crack wanders horizontally between its segments, in u. */
const DRIFT_U = 0.035
/** How far it climbs per segment, in v. */
const CLIMB_V = 0.22

/**
 * Lay out `count` cracks on one storey.
 *
 * They start low and climb, because that is where a storey is worked hardest:
 * the bending stress this engine reports is taken at the base of the storey, so
 * a crack that starts at the ceiling would be drawing the opposite of what the
 * numbers say. Each one zig-zags, because a crack in a real wall follows the
 * weakest path rather than a straight line, and a straight line reads as a
 * drawn-on stripe.
 */
export function crackPolylines(seed: number, count: number): Crack[] {
  const random = seeded(seed * 2654435761)
  const cracks: Crack[] = []

  for (let i = 0; i < count; i += 1) {
    // Spread the starting points around the perimeter rather than clustering
    // them: `i / count` places them evenly and the jitter stops the result
    // looking like a pattern.
    const startU = (i / Math.max(count, 1) + random() * 0.6) % 1
    const startV = random() * 0.18
    const segments = 2 + Math.floor(random() * 3)

    const points: Crack = [{ u: startU, v: startV }]
    let u = startU
    let v = startV
    for (let s = 0; s < segments; s += 1) {
      u += (random() - 0.5) * 2 * DRIFT_U
      v += CLIMB_V * (0.6 + random() * 0.8)
      if (v > 1) break
      points.push({ u: (u + 1) % 1, v })
    }
    // A single point is not a line. Two is the minimum that draws.
    if (points.length >= 2) cracks.push(points)
  }

  return cracks
}

/** How many cracks a storey in each damaged state gets. Drawing only. */
export const CRACK_COUNT: Readonly<Record<string, number>> = {
  intact: 0,
  cracked: 3,
  severe: 7,
  collapsed: 9,
}
