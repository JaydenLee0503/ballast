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
  concrete: { roughness: 0.88, metalness: 0.02, surface: 'panel', relief: 0.16 },
  steel: { roughness: 0.32, metalness: 0.72, surface: 'mullion', relief: 0.2 },
  aluminium: { roughness: 0.24, metalness: 0.85, surface: 'rib', relief: 0.16 },
  timber: { roughness: 0.74, metalness: 0.0, surface: 'grain', relief: 0.12 },
  bamboo: { roughness: 0.66, metalness: 0.0, surface: 'culm', relief: 0.14 },
  masonry: { roughness: 0.94, metalness: 0.0, surface: 'course', relief: 0.18 },
  earth: { roughness: 1.0, metalness: 0.0, surface: 'lift', relief: 0.2 },
}

export function materialLook(structuralClass: StructuralClass): MaterialLook {
  return MATERIAL_LOOK[structuralClass]
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
