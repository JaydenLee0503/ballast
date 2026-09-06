/**
 * What a structural material looks like — as distinct from what it means.
 *
 * Colour is already spoken for. `palette.ts` owns it: a storey is green, amber
 * or red because of its utilisation, and `StoreyStack`'s header is explicit
 * that the facade controls do not get to interfere with that readout. So a
 * material cannot express itself as a hue without competing with the one
 * signal on the building that carries engineering meaning.
 *
 * This module carries the other half of appearance instead: how a surface
 * *finishes*. How rough it is, whether it is metallic, and what pattern the
 * wall is set out in. Steel reads as steel because it has a sheen and vertical
 * bays; rammed earth reads as rammed earth because it is dead matte and lifts
 * in horizontal courses. Two walls at the same utilisation stay the same
 * green — the way two real walls painted the same colour would — and nobody
 * can mistake a finish for a safety state, because the finish never touches
 * the hue.
 *
 * Keyed by `StructuralClass`, not by material id: the look is a property of
 * the family. Both timbers get grain, and so would a third if one were added,
 * without anybody having to remember to add it here.
 */

import type { StructuralClass } from '@/engine'

/**
 * The set-out drawn across a wall. Names are the building thing, not the
 * graphics thing, so the table below reads as a spec rather than as effects.
 */
export type SurfacePattern =
  /** Cast panel joints — a wide grid, both directions. */
  | 'panel'
  /** Vertical structural bays, the rhythm of a framed elevation. */
  | 'mullion'
  /** Fine vertical plank lines. */
  | 'grain'
  /** Narrow vertical culms, tighter than timber grain. */
  | 'culm'
  /** Horizontal rammed lifts, the layers left by the formwork. */
  | 'lift'
  /** Brick coursing: horizontal beds, perpends offset every other row. */
  | 'course'
  /** Fine vertical ribs, an extruded profile. */
  | 'rib'

export interface MaterialLook {
  /** three.js `MeshStandardMaterial.roughness`, 0..1. */
  readonly roughness: number
  /** three.js `MeshStandardMaterial.metalness`, 0..1. */
  readonly metalness: number
  readonly surface: SurfacePattern
  /**
   * The material's own colour. Mixed *into* the utilisation band rather than
   * replacing it — see `wallColor` for why that distinction is the whole ball
   * game.
   */
  readonly tint: string
  /**
   * How hard the pattern is drawn, 0..1. Kept low across the board: this is a
   * joint line catching a shadow, not a painted stripe. Anything strong enough
   * to notice at a glance would start competing with the band colour, which is
   * exactly what this module exists to avoid.
   */
  readonly relief: number
}

/**
 * One entry per `StructuralClass`. `Record` rather than a partial map plus a
 * default, so adding a class to the engine's union fails the typecheck here
 * until somebody decides what it looks like — a silent fallback to concrete
 * would be a material that quietly lies about itself.
 */
export const MATERIAL_LOOK: Readonly<Record<StructuralClass, MaterialLook>> = {
  concrete: {
    roughness: 0.88, metalness: 0.02, surface: 'panel', relief: 0.16,
    tint: '#b9b4ac',
  },
  steel: {
    roughness: 0.32, metalness: 0.72, surface: 'mullion', relief: 0.2,
    tint: '#93a1ad',
  },
  aluminium: {
    roughness: 0.24, metalness: 0.85, surface: 'rib', relief: 0.16,
    tint: '#c7ced4',
  },
  timber: {
    roughness: 0.74, metalness: 0.0, surface: 'grain', relief: 0.12,
    tint: '#c08b52',
  },
  bamboo: {
    roughness: 0.66, metalness: 0.0, surface: 'culm', relief: 0.14,
    tint: '#cdb06a',
  },
  masonry: {
    roughness: 0.94, metalness: 0.0, surface: 'course', relief: 0.18,
    tint: '#a5563d',
  },
  earth: {
    roughness: 1.0, metalness: 0.0, surface: 'lift', relief: 0.2,
    tint: '#a8815a',
  },
}

export function materialLook(structuralClass: StructuralClass): MaterialLook {
  return MATERIAL_LOOK[structuralClass]
}

/**
 * How far the wall is pulled towards the material's own colour, 0..1.
 *
 * This is the one number that trades the two readings against each other, so
 * it is a named constant and not a literal buried in a component. At 0 the
 * building is pure utilisation colour and materials differ only in finish; at
 * 1 the utilisation band is gone entirely and the colour means nothing about
 * safety.
 *
 * `materialLook.test.ts` asserts the invariant that bounds it: every tinted
 * storey must stay closer to its *own* band than to either of the other two.
 * Measured, that holds up to about 0.56 and fails by 0.58 — a tinted amber
 * and a tinted red converge. 0.42 sits deliberately short of the cliff, with
 * roughly 19 units of RGB margin left, because the failure at the edge is the
 * worst kind: a storey that looks like a different safety state entirely.
 *
 * This is the knob to turn if the material colour reads too weakly or too
 * strongly. The test will stop you before the readout breaks.
 */
export const MATERIAL_TINT_STRENGTH = 0.42

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

function toHex([r, g, b]: readonly [number, number, number]): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `#${((clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).padStart(6, '0')}`
}

/**
 * The colour a wall is actually painted: the utilisation band, carried part of
 * the way towards the material's own colour.
 *
 * A mix rather than a replacement, and that is the entire design. Utilisation
 * still sets which of three colours the storey is *near*, so a failing storey
 * is still unmistakably the red one; the material then says which red — the
 * cool grey-red of steel, the warm ochre-red of rammed earth. Both readings
 * survive because neither gets the whole channel.
 *
 * Linear in sRGB, deliberately: this is a paint mix, and matching the eye
 * matters less here than being obvious enough to reason about when somebody
 * later asks why a particular wall came out the colour it did.
 */
export function wallColor(
  bandHex: string,
  tintHex: string,
  strength: number = MATERIAL_TINT_STRENGTH,
): string {
  const band = channels(bandHex)
  const tint = channels(tintHex)
  const t = Math.max(0, Math.min(1, strength))
  return toHex([
    band[0] + (tint[0] - band[0]) * t,
    band[1] + (tint[1] - band[1]) * t,
    band[2] + (tint[2] - band[2]) * t,
  ])
}

/** Straight-line distance in RGB. Only ever used to compare two mixes. */
export function colorDistance(a: string, b: string): number {
  const [ar, ag, ab] = channels(a)
  const [br, bg, bb] = channels(b)
  return Math.hypot(ar - br, ag - bg, ab - bb)
}

/**
 * Pattern ids as the shader sees them. GLSL has no enums, so the fragment
 * shader branches on a float; this table is the one place the two agree, and
 * `windows.ts` reads it rather than repeating the numbers.
 */
export const SURFACE_CODE: Readonly<Record<SurfacePattern, number>> = {
  panel: 0,
  mullion: 1,
  grain: 2,
  culm: 3,
  lift: 4,
  course: 5,
  rib: 6,
}
