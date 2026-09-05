/**
 * The world around the plot — city blocks, streets, trees, traffic, stars —
 * laid out once at module load.
 *
 * This is scenery, and the point of it is scale: a 40 m tower means nothing
 * next to an empty grid, and a great deal next to four-storey walk-ups, street
 * trees and a road you could put a car on. It is also the reason the studio
 * reads as a place rather than a diagram — you are building *somewhere*.
 *
 * Two rules make that safe:
 *
 * 1. **It carries no engine meaning.** No colour, size or position here traces
 *    to an `AnalysisResult`, and nothing here feeds one. The neighbours are
 *    not designs and are not analysed; they are context. Everything that means
 *    something — storey colour, arrow length — still comes from the engine and
 *    still lives in `StoreyStack` and `WindArrows`.
 * 2. **It never moves.** The layout is a module constant, generated from a
 *    fixed seed, so the same city appears on every load and does not shuffle
 *    when a slider does. A neighbourhood that rearranged itself as the student
 *    edited would look like output.
 *
 * Sized for the largest design the controls can express (60 x 60 m plan, see
 * `lib/limits.ts`), so the plot never outgrows its block.
 */

/** Half-width of a city block's interior — the buildable land. */
export const BLOCK_HALF_M = 52
/** Pavement ring around each block. */
export const SIDEWALK_M = 5
/** Half-width of the carriageway. */
export const ROAD_HALF_M = 8
/** Block centre to block centre: interior + two pavements + one road. */
export const BLOCK_PITCH_M =
  2 * (BLOCK_HALF_M + SIDEWALK_M + ROAD_HALF_M)
/** Blocks are laid out on `[-BLOCK_RANGE, BLOCK_RANGE]` squared. */
export const BLOCK_RANGE = 2
/**
 * The prepared pad the design sits on. Half of 72 m clears a 60 m plan — the
 * widest `PLAN_WIDTH_LIMITS_M` allows — with 6 m of hardstanding to spare.
 */
export const SITE_PAD_HALF_M = 36
/** The ground plane. Large enough that its edge is well inside the fog. */
export const GROUND_EXTENT_M = 2400
/** How far the asphalt strips run; past the last block, into the haze. */
export const ROAD_LENGTH_M = 760

/** Centrelines of the streets, one between each pair of blocks. */
export const ROAD_CENTRES_M: readonly number[] = Array.from(
  { length: 2 * BLOCK_RANGE + 2 },
  (_, i) => (i - BLOCK_RANGE - 1 + 0.5) * BLOCK_PITCH_M,
)

/**
 * mulberry32. A named, seeded generator rather than `Math.random`, for the
 * same reason the engine has no randomness at all: a demo that looked
 * different on every refresh would make a student wonder what else moved.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Index into a non-empty table without an assertion. */
function pick<T>(items: readonly T[], u: number): T {
  const chosen = items[Math.min(items.length - 1, Math.floor(u * items.length))]
  if (chosen === undefined) throw new Error('scenery: empty table')
  return chosen
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u
}

export interface Neighbour {
  readonly x: number
  readonly z: number
  readonly widthX_m: number
  readonly widthZ_m: number
  readonly height_m: number
  readonly color: string
}

export type TreeKind = 'broadleaf' | 'conifer'

export interface Tree {
  readonly x: number
  readonly z: number
  /** Overall size multiplier; a street of identical trees looks stamped. */
  readonly scale: number
  readonly kind: TreeKind
  readonly foliage: string
}

export interface Car {
  readonly x: number
  readonly z: number
  readonly rotationY: number
  readonly color: string
}

/**
 * Facades. Deliberately desaturated: the only saturated colours in the scene
 * should be the ones that mean something — the utilisation bands on the
 * student's own building and the blue of the wind arrows.
 */
const FACADE_COLORS = [
  '#8d8378',
  '#9a948b',
  '#7d8a90',
  '#a8998a',
  '#6f7a80',
  '#948b7e',
  '#8a8f92',
  '#a39683',
] as const

const FOLIAGE_COLORS = [
  '#4f7a42',
  '#5d8a4a',
  '#436b3c',
  '#6b9455',
  '#385c37',
] as const

const CAR_COLORS = [
  '#c9564b',
  '#3f6fb0',
  '#d8d2c8',
  '#4a4f57',
  '#c9a94b',
  '#5c8f6b',
] as const

/** Storey height used to quantise neighbour heights so they read as buildings. */
const NEIGHBOUR_STOREY_M = 3.4
/** Lots per block edge. Three gives a street frontage without a crowd. */
const LOTS_PER_EDGE = 3

const random = mulberry32(0x8a11a57)

const neighbours: Neighbour[] = []
const trees: Tree[] = []
const cars: Car[] = []

/** Block centres, in order, so the generated layout is deterministic. */
const blockCentres: Array<{ i: number; j: number; x: number; z: number }> = []
for (let i = -BLOCK_RANGE; i <= BLOCK_RANGE; i += 1) {
  for (let j = -BLOCK_RANGE; j <= BLOCK_RANGE; j += 1) {
    blockCentres.push({ i, j, x: i * BLOCK_PITCH_M, z: j * BLOCK_PITCH_M })
  }
}

const lotSpan = (2 * BLOCK_HALF_M) / LOTS_PER_EDGE

for (const block of blockCentres) {
  const isSite = block.i === 0 && block.j === 0
  // A park every so often, so the skyline is not a uniform field of boxes and
  // there is somewhere for the eye to rest.
  const isPark = !isSite && random() < 0.18

  if (!isSite && !isPark) {
    for (let lx = 0; lx < LOTS_PER_EDGE; lx += 1) {
      for (let lz = 0; lz < LOTS_PER_EDGE; lz += 1) {
        // An empty lot here and there: real blocks have car parks and gaps.
        if (random() < 0.14) continue

        const lotX = block.x + (lx - (LOTS_PER_EDGE - 1) / 2) * lotSpan
        const lotZ = block.z + (lz - (LOTS_PER_EDGE - 1) / 2) * lotSpan
        const widthX_m = lotSpan * lerp(0.5, 0.78, random())
        const widthZ_m = lotSpan * lerp(0.5, 0.78, random())
        // Jitter within the lot, never out of it, so nothing lands on a road.
        const slackX = (lotSpan - widthX_m) / 2
        const slackZ = (lotSpan - widthZ_m) / 2
        const tall = random() < 0.12
        const raw = tall ? lerp(28, 62, random()) : lerp(7, 27, random())

        neighbours.push({
          x: lotX + (random() * 2 - 1) * slackX * 0.6,
          z: lotZ + (random() * 2 - 1) * slackZ * 0.6,
          widthX_m,
          widthZ_m,
          height_m: Math.max(1, Math.round(raw / NEIGHBOUR_STOREY_M)) * NEIGHBOUR_STOREY_M,
          color: pick(FACADE_COLORS, random()),
        })
      }
    }
  }

  if (isPark) {
    for (let px = 0; px < 5; px += 1) {
      for (let pz = 0; pz < 5; pz += 1) {
        if (random() < 0.18) continue
        const step = (2 * BLOCK_HALF_M - 20) / 4
        trees.push({
          x: block.x + (px - 2) * step + (random() * 2 - 1) * 5,
          z: block.z + (pz - 2) * step + (random() * 2 - 1) * 5,
          scale: lerp(0.85, 1.5, random()),
          kind: random() < 0.7 ? 'broadleaf' : 'conifer',
          foliage: pick(FOLIAGE_COLORS, random()),
        })
      }
    }
  }

  // Street trees on all four edges of every block, the site's included — the
  // plot is a building site in a city, not a clearing.
  const edgeInset = BLOCK_HALF_M - 3
  const spacing = 15.5
  const count = Math.floor((2 * edgeInset) / spacing)
  for (let edge = 0; edge < 4; edge += 1) {
    for (let n = 0; n <= count; n += 1) {
      if (random() < 0.22) continue
      const along = -edgeInset + (n / count) * 2 * edgeInset + (random() * 2 - 1) * 2.5
      const across = edge % 2 === 0 ? edgeInset : -edgeInset
      const swap = edge < 2
      trees.push({
        x: block.x + (swap ? along : across),
        z: block.z + (swap ? across : along),
        scale: lerp(0.75, 1.25, random()),
        kind: random() < 0.75 ? 'broadleaf' : 'conifer',
        foliage: pick(FOLIAGE_COLORS, random()),
      })
    }
  }
}

/** Half-width of the box kept clear of parked cars at a junction. */
const JUNCTION_CLEARANCE_M = 14
/** Cars only on the streets a student can actually see from the plot. */
const CAR_STREET_LIMIT_M = 200

function inJunction(along: number): boolean {
  return ROAD_CENTRES_M.some(
    (centre) => Math.abs(along - centre) < JUNCTION_CLEARANCE_M,
  )
}

for (const centre of ROAD_CENTRES_M) {
  if (Math.abs(centre) > CAR_STREET_LIMIT_M) continue
  for (let axis = 0; axis < 2; axis += 1) {
    for (let n = 0; n < 4; n += 1) {
      const along = (random() * 2 - 1) * CAR_STREET_LIMIT_M
      if (inJunction(along)) continue
      // One lane each side of the centreline, which is also which way it faces.
      const lane = random() < 0.5 ? -ROAD_HALF_M / 2 : ROAD_HALF_M / 2
      const color = pick(CAR_COLORS, random())
      cars.push(
        axis === 0
          ? { x: along, z: centre + lane, rotationY: 0, color }
          : { x: centre + lane, z: along, rotationY: Math.PI / 2, color },
      )
    }
  }
}

export interface SidewalkSlab {
  readonly x: number
  readonly z: number
  readonly spanX: number
  readonly spanZ: number
}

/**
 * Pavement rings, four slabs per block. Each block carries its own ring rather
 * than the streets carrying kerbs, so a block is one self-contained thing and
 * the pattern holds however far the grid is extended.
 */
export const SIDEWALK_SLABS: readonly SidewalkSlab[] = blockCentres.flatMap(
  ({ x, z }) => {
    const offset = BLOCK_HALF_M + SIDEWALK_M / 2
    const across = 2 * (BLOCK_HALF_M + SIDEWALK_M)
    const along = 2 * BLOCK_HALF_M
    return [
      { x, z: z - offset, spanX: across, spanZ: SIDEWALK_M },
      { x, z: z + offset, spanX: across, spanZ: SIDEWALK_M },
      { x: x - offset, z, spanX: SIDEWALK_M, spanZ: along },
      { x: x + offset, z, spanX: SIDEWALK_M, spanZ: along },
    ]
  },
)

export const NEIGHBOURS: readonly Neighbour[] = neighbours
export const TREES: readonly Tree[] = trees
export const CARS: readonly Car[] = cars

/**
 * Dashed centrelines. Generated rather than drawn as a texture, because the
 * scene fetches no assets at runtime (see `Viewport.tsx`) and a dash is one
 * quad.
 */
export interface Dash {
  readonly along: number
}

const DASH_PITCH_M = 16

export const DASHES: readonly Dash[] = Array.from(
  { length: Math.floor(ROAD_LENGTH_M / DASH_PITCH_M) },
  (_, n) => ({ along: -ROAD_LENGTH_M / 2 + (n + 0.5) * DASH_PITCH_M }),
).filter(({ along }) => !inJunction(along))

export const DASH_LENGTH_M = 6

/**
 * The star field: unit directions on the upper hemisphere, to be scaled onto
 * the sky dome. Seeded from the same generator as the streets, so the sky over
 * the studio is also the same sky every time.
 */
const STAR_COUNT = 900

export const STAR_DIRECTIONS: Float32Array = (() => {
  const positions = new Float32Array(STAR_COUNT * 3)
  const rng = mulberry32(0x5747)
  for (let n = 0; n < STAR_COUNT; n += 1) {
    // Uniform on the hemisphere: y uniform in (0, 1], azimuth uniform.
    const y = 0.02 + rng() * 0.98
    const ring = Math.sqrt(Math.max(0, 1 - y * y))
    const azimuth = rng() * Math.PI * 2
    positions[n * 3] = Math.cos(azimuth) * ring
    positions[n * 3 + 1] = y
    positions[n * 3 + 2] = Math.sin(azimuth) * ring
  }
  return positions
})()
