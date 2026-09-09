/**
 * Building archetypes: the presets behind "what kind of building is this?".
 *
 * A typology here is a *starting point*, not a mode. Choosing "House" writes
 * an ordinary `Structure` — six or seven fields a student could have set by
 * hand — and then every existing control still works on it. Nothing about the
 * simulation branches on which archetype was picked, which is the point: a
 * house and an office tower are analysed by exactly the same physics, and the
 * only reason they behave differently is that they are different shapes made
 * of different materials.
 *
 * This lives in `lib/` rather than in `engine/` for the same reason
 * `limits.ts` does: it constrains and generates *editing* input. The engine
 * never imports it, and `analyze()` cannot tell a preset structure from a
 * hand-built one.
 *
 * WHAT IS DELIBERATELY ABSENT. There is no stadium and no sports pitch. The
 * engine models a storey as a gross volume times a structural fraction and
 * resolves lateral wind into base shear and overturning; it has no long-span
 * element and no uplift load case, which are precisely the two things that
 * govern a stadium roof. A stadium assembled out of storey boxes would
 * produce a carbon figure and a safety factor that look authoritative and are
 * not, and that is the one failure this codebase is built to refuse. Adding
 * one means adding a structural form to the engine, with its own citations
 * and its own tests — not an entry in this table.
 *
 * A student can still ask for one, in words, through `ai/blueprint/`. What they
 * get is not a stadium: it is the closest honest stack of boxes, stamped
 * `'custom'`, with the engine's fixed sentences about what is missing printed
 * beside it — no long-span element, no uplift case, no crowd on the floor. That
 * is the difference between refusing to pretend and refusing to answer.
 */

import type {
  FacadeSystem,
  FoundationType,
  LateralSystem,
  Structure,
  Typology,
} from '@/engine'
import {
  clamp,
  PLAN_WIDTH_LIMITS_M,
  STOREY_COUNT_LIMITS,
  STOREY_HEIGHT_LIMITS_M,
} from '@/lib/limits.ts'

/**
 * The roof drawn on top of the stack.
 *
 * Silhouette only. The engine has no roof: it charges no carbon for one, gives
 * it no weight and puts no wind on it, so the viewport draws it in the neutral
 * grey it uses for the foundation block rather than in a utilisation colour.
 * That is the scene's existing way of saying "this part is not analysed", and
 * keeping to it is what stops a roof from looking like a storey that happens
 * to be safe.
 *
 * If roofs should ever count towards carbon — and they should — that is a term
 * in `sustainability.ts` with a cited factor, not a number invented here.
 */
export type RoofForm = 'flat' | 'parapet' | 'pitched' | 'monopitch'

export interface Archetype {
  readonly typology: Typology
  /** Chip label. Short: it sits in a row of them. */
  readonly label: string
  /** One line, in a student's language, on what this is for. */
  readonly blurb: string
  readonly storeyCount: number
  readonly storeyHeight_m: number
  readonly widthX_m: number
  readonly widthY_m: number
  readonly materialId: string
  readonly lateralSystem: LateralSystem
  readonly facade: FacadeSystem
  readonly foundationType: FoundationType
  readonly embedmentDepth_m: number
  readonly anchorCapacity_kN: number
  readonly roof: RoofForm
}

/**
 * The presets. Every number sits inside `limits.ts`, so picking any archetype
 * produces a design the sliders can still express and the parser will still
 * accept — a preset that put a control out of range would be a trap.
 */
export const ARCHETYPES: readonly Archetype[] = [
  {
    typology: 'house',
    label: 'House',
    blurb: 'Two floors, brick, pitched roof. The smallest thing worth analysing.',
    storeyCount: 2,
    storeyHeight_m: 3,
    widthX_m: 11,
    widthY_m: 9,
    materialId: 'clay-brick-masonry',
    lateralSystem: 'shear-wall',
    facade: 'punched',
    foundationType: 'strip-footing',
    embedmentDepth_m: 0.8,
    anchorCapacity_kN: 200,
    roof: 'pitched',
  },
  {
    typology: 'townhouse',
    label: 'Townhouse',
    blurb: 'Narrow and three storeys, the way a terrace is built.',
    storeyCount: 3,
    storeyHeight_m: 3.1,
    widthX_m: 7,
    widthY_m: 12,
    materialId: 'clay-brick-masonry',
    lateralSystem: 'shear-wall',
    facade: 'punched',
    foundationType: 'strip-footing',
    embedmentDepth_m: 1,
    anchorCapacity_kN: 250,
    roof: 'pitched',
  },
  {
    typology: 'apartment-block',
    label: 'Apartments',
    blurb: 'Mid-rise timber housing. Light, and low carbon for its size.',
    storeyCount: 8,
    storeyHeight_m: 3.2,
    widthX_m: 24,
    widthY_m: 16,
    materialId: 'cross-laminated-timber',
    lateralSystem: 'shear-wall',
    facade: 'ribbon',
    foundationType: 'raft',
    embedmentDepth_m: 1.5,
    anchorCapacity_kN: 700,
    roof: 'parapet',
  },
  {
    typology: 'office-tower',
    label: 'Office tower',
    blurb: 'Tall, steel and mostly glass. Where the wind starts to matter.',
    storeyCount: 18,
    storeyHeight_m: 3.8,
    widthX_m: 32,
    widthY_m: 32,
    materialId: 'structural-steel',
    lateralSystem: 'braced-frame',
    facade: 'curtain-wall',
    foundationType: 'piled',
    embedmentDepth_m: 3,
    anchorCapacity_kN: 2200,
    roof: 'flat',
  },
  {
    typology: 'warehouse',
    label: 'Warehouse',
    blurb: 'One enormous floor, no cladding to speak of.',
    storeyCount: 1,
    storeyHeight_m: 8,
    widthX_m: 56,
    widthY_m: 36,
    materialId: 'structural-steel',
    lateralSystem: 'braced-frame',
    facade: 'exposed',
    foundationType: 'slab-on-grade',
    embedmentDepth_m: 0.4,
    anchorCapacity_kN: 300,
    roof: 'monopitch',
  },
  {
    typology: 'school',
    label: 'School',
    blurb: 'Low, wide and concrete. Long corridors, lots of windows.',
    storeyCount: 3,
    storeyHeight_m: 3.6,
    widthX_m: 44,
    widthY_m: 20,
    materialId: 'reinforced-concrete',
    lateralSystem: 'moment-frame',
    facade: 'ribbon',
    foundationType: 'raft',
    embedmentDepth_m: 1.2,
    anchorCapacity_kN: 600,
    roof: 'flat',
  },
]

export function archetype(typology: Typology): Archetype | undefined {
  return ARCHETYPES.find((entry) => entry.typology === typology)
}

/**
 * The roof for a design. `'custom'` — and any typology without an archetype —
 * gets a flat top, which is what the building looked like before roofs
 * existed. A design that never claimed to be a house does not get a gable.
 */
export function roofForm(typology: Typology): RoofForm {
  return archetype(typology)?.roof ?? 'flat'
}

/**
 * Build the structure an archetype describes.
 *
 * Every field is clamped on the way out. The table above is already inside the
 * limits and a test asserts it, but clamping here means a future edit to one
 * and not the other degrades to a legal design rather than to one the parser
 * rejects on reload.
 */
export function structureFor(entry: Archetype): Structure {
  const storeyCount = clamp(entry.storeyCount, STOREY_COUNT_LIMITS)
  return {
    typology: entry.typology,
    storeys: Array.from({ length: Math.round(storeyCount) }, () => ({
      height_m: clamp(entry.storeyHeight_m, STOREY_HEIGHT_LIMITS_M),
      widthX_m: clamp(entry.widthX_m, PLAN_WIDTH_LIMITS_M),
      widthY_m: clamp(entry.widthY_m, PLAN_WIDTH_LIMITS_M),
      materialId: entry.materialId,
      lateralSystem: entry.lateralSystem,
      facade: entry.facade,
      // Every archetype is rectangular. A round plan is a deliberate move, not
      // something a preset should make on a student's behalf — and none of these
      // six buildings is one in the world either.
      planShape: 'rectangle',
    })),
    foundation: {
      type: entry.foundationType,
      embedmentDepth_m: entry.embedmentDepth_m,
      anchorCapacity_kN: entry.anchorCapacity_kN,
    },
    exposureCategory: 'C',
  }
}
