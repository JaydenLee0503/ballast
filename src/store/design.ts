/**
 * Design state: the structure and the hazard a student is editing.
 *
 * What is deliberately NOT in here: anything `analyze()` can derive. Safety
 * factors, carbon, drift and per-storey utilisation are recomputed from
 * (structure, hazard) at the point of use — see useAnalysis.ts. Caching an
 * engine result in the store would give the app two sources of truth for a
 * safety factor, and the one that went stale would be the one on screen.
 *
 * Every action replaces `structure` (or `hazard`) with a new object rather
 * than mutating, so object identity is a valid cache key for the analysis
 * memo. If you ever mutate in place here, the numbers stop updating.
 */

import { create } from 'zustand'
import {
  ANCHOR_CAPACITY_LIMITS_KN,
  clamp,
  GUST_SPEED_LIMITS_KMH,
  PLAN_WIDTH_LIMITS_M,
  STOREY_COUNT_LIMITS,
  TAPER_LIMITS,
} from '@/lib/limits.ts'
import type { SavedDesign } from '@/persistence'
import type {
  ExposureCategory,
  FacadeSystem,
  LateralSystem,
  Storey,
  Structure,
  WindHazard,
} from '@/engine'

/**
 * Starting point: a mid-rise CLT block. Chosen because it sits in the
 * interesting part of the design space — comfortably safe in a normal gale,
 * and in trouble by the top of the gust slider, so the first thing a student
 * does reveals the tradeoff rather than a wall of green.
 */
export const DEFAULT_STRUCTURE: Structure = {
  storeys: Array.from({ length: 6 }, () => ({
    height_m: 3.5,
    widthX_m: 18,
    widthY_m: 12,
    materialId: 'cross-laminated-timber',
    lateralSystem: 'shear-wall' as const,
    facade: 'punched' as const,
  })),
  foundation: { type: 'raft', embedmentDepth_m: 1.5, anchorCapacity_kN: 600 },
  exposureCategory: 'C',
}

export const DEFAULT_HAZARD: WindHazard = {
  kind: 'wind',
  gustSpeed_kmh: 150,
  directionDeg: 0,
  // 0.02 m is open terrain, the roughness the engine associates with
  // Exposure C — consistent with DEFAULT_STRUCTURE, so no warning on load.
  terrainRoughness: 0.02,
}

/**
 * The design the current one is measured against.
 *
 * It carries its own label because where a baseline came from is the whole of
 * its meaning: "vs. the design you started from" and "vs. the one you pinned
 * ten minutes ago" are different claims about the same percentages.
 */
export interface Baseline {
  label: string
  structure: Structure
  hazard: WindHazard
}

export const STARTING_BASELINE: Baseline = {
  label: 'Starting design',
  structure: DEFAULT_STRUCTURE,
  hazard: DEFAULT_HAZARD,
}

export interface DesignState {
  structure: Structure
  hazard: WindHazard
  baseline: Baseline
  /** Which storey the controls edit. `null` means "all storeys at once". */
  selectedStoreyIndex: number | null

  /**
   * How much the plan shrinks from the ground storey to the top, 0..0.6.
   *
   * This is an *input the widths are generated from*, not a second copy of
   * them: `Structure` stores per-storey widths and always has, the engine has
   * always read them, and a saved design round-trips them exactly. What is
   * kept here is the shape control that produced them, because you cannot
   * recover "the user asked for a 30% taper" from a list of numbers any more
   * than you can recover a slider from a colour.
   *
   * On `loadDesign` it is re-derived from the design's own widths, so the
   * control shows something honest about a design it did not generate. A
   * structure whose widths are not a clean linear taper derives to the closest
   * one, and the next drag of the control imposes it — which is the same thing
   * every "set all storeys" control in here already does.
   */
  taper: number

  selectStorey: (index: number | null) => void

  setGustSpeed: (gustSpeed_kmh: number) => void
  setDirection: (directionDeg: number) => void
  setExposure: (category: ExposureCategory) => void

  addStorey: () => void
  removeStorey: () => void
  setPlanDimensions: (widthX_m: number, widthY_m: number) => void
  setAnchorCapacity: (anchorCapacity_kN: number) => void

  /** Regenerate every storey's plan from the ground storey and this taper. */
  setTaper: (taper: number) => void

  setStoreyMaterial: (index: number, materialId: string) => void
  setStoreySystem: (index: number, lateralSystem: LateralSystem) => void
  setStoreyFacade: (index: number, facade: FacadeSystem) => void
  setAllMaterial: (materialId: string) => void
  setAllSystem: (lateralSystem: LateralSystem) => void
  setAllFacade: (facade: FacadeSystem) => void

  /**
   * Replace the whole design, as when opening a saved one or a shared link.
   *
   * It takes a `SavedDesign` rather than a loose structure and hazard because
   * the only ways to hold one are `parseDesign`, which has checked every field
   * against the same limits the controls enforce, and `createSavedDesign`,
   * which is given state that was already in the store. No clamping happens
   * here: a value that needed clamping got past the parser, and quietly
   * repairing it would hide that.
   */
  loadDesign: (design: SavedDesign) => void

  /** Measure from here: the design on screen becomes the new baseline. */
  pinBaseline: () => void
  /** Back to the design the studio opens with. */
  resetBaseline: () => void

  reset: () => void
}

/** Replace one storey, leaving the rest of the structure alone. */
function withStorey(
  structure: Structure,
  index: number,
  change: Partial<Storey>,
): Structure {
  if (index < 0 || index >= structure.storeys.length) return structure
  return {
    ...structure,
    storeys: structure.storeys.map((storey, i) =>
      i === index ? { ...storey, ...change } : storey,
    ),
  }
}

/** Replace the same fields on every storey. */
function withAllStoreys(
  structure: Structure,
  change: Partial<Storey>,
): Structure {
  return {
    ...structure,
    storeys: structure.storeys.map((storey) => ({ ...storey, ...change })),
  }
}

/** Widths are shown to 0.1 m, so they are stored to 0.1 m. */
function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Rebuild every storey's plan from a base size and a taper.
 *
 * Always regenerated from (base, taper) rather than scaled from whatever is
 * currently there: scaling accumulates rounding every time a width slider
 * moves, and after a dozen drags the "prismatic" tower is quietly a 2% cone.
 *
 * The clamp matters. `PLAN_WIDTH_LIMITS_M.min` is 4 m, so a deep taper on a
 * narrow base flattens the top few storeys against the floor rather than
 * generating widths the parser would later refuse to load.
 */
function withTaperedPlan(
  structure: Structure,
  baseX_m: number,
  baseY_m: number,
  taper: number,
): Structure {
  const count = structure.storeys.length
  return {
    ...structure,
    storeys: structure.storeys.map((storey, i) => {
      const shrink = count <= 1 ? 0 : (i / (count - 1)) * taper
      return {
        ...storey,
        widthX_m: clamp(round1(baseX_m * (1 - shrink)), PLAN_WIDTH_LIMITS_M),
        widthY_m: clamp(round1(baseY_m * (1 - shrink)), PLAN_WIDTH_LIMITS_M),
      }
    }),
  }
}

/**
 * The taper a structure appears to have, for a design that arrived from
 * somewhere else. Reads the top storey against the ground one; a stack that
 * was never generated by `withTaperedPlan` gets the closest linear answer.
 */
export function deriveTaper(structure: Structure): number {
  const base = structure.storeys[0]
  const top = structure.storeys[structure.storeys.length - 1]
  if (base === undefined || top === undefined || base.widthX_m <= 0) return 0
  return clamp(1 - top.widthX_m / base.widthX_m, TAPER_LIMITS)
}

/** Re-apply the current taper after the storey count changes. */
function retaper(structure: Structure, taper: number): Structure {
  const base = structure.storeys[0]
  if (base === undefined) return structure
  return withTaperedPlan(structure, base.widthX_m, base.widthY_m, taper)
}

export const useDesignStore = create<DesignState>()((set) => ({
  structure: DEFAULT_STRUCTURE,
  hazard: DEFAULT_HAZARD,
  baseline: STARTING_BASELINE,
  selectedStoreyIndex: null,
  taper: 0,

  selectStorey: (index) => set({ selectedStoreyIndex: index }),

  setGustSpeed: (gustSpeed_kmh) =>
    set((state) => ({
      hazard: {
        ...state.hazard,
        gustSpeed_kmh: clamp(gustSpeed_kmh, GUST_SPEED_LIMITS_KMH),
      },
    })),

  setDirection: (directionDeg) =>
    set((state) => ({
      hazard: {
        ...state.hazard,
        // Wrap rather than clamp: 350 deg and 10 deg are neighbours, and a
        // direction control that sticks at its ends feels broken.
        directionDeg: Number.isFinite(directionDeg)
          ? ((directionDeg % 360) + 360) % 360
          : 0,
      },
    })),

  setExposure: (category) =>
    set((state) => ({
      structure: { ...state.structure, exposureCategory: category },
    })),

  addStorey: () =>
    set((state) => {
      const storeys = state.structure.storeys
      const top = storeys[storeys.length - 1]
      if (!top || storeys.length >= STOREY_COUNT_LIMITS.max) return state
      // New storeys copy the one below, so adding height does not silently
      // change the material, envelope or lateral system of the design. The
      // taper is then re-applied across the new count, so a tapered tower
      // stays a tapered tower rather than growing a straight extension.
      return {
        structure: retaper(
          { ...state.structure, storeys: [...storeys, { ...top }] },
          state.taper,
        ),
      }
    }),

  removeStorey: () =>
    set((state) => {
      const storeys = state.structure.storeys
      if (storeys.length <= STOREY_COUNT_LIMITS.min) return state
      const next = storeys.slice(0, -1)
      return {
        structure: retaper({ ...state.structure, storeys: next }, state.taper),
        // Keep the selection pointing at a storey that still exists.
        selectedStoreyIndex:
          state.selectedStoreyIndex !== null &&
          state.selectedStoreyIndex >= next.length
            ? null
            : state.selectedStoreyIndex,
      }
    }),

  // The sliders set the *ground* storey; the taper spreads that up the stack.
  setPlanDimensions: (widthX_m, widthY_m) =>
    set((state) => ({
      structure: withTaperedPlan(
        state.structure,
        clamp(widthX_m, PLAN_WIDTH_LIMITS_M),
        clamp(widthY_m, PLAN_WIDTH_LIMITS_M),
        state.taper,
      ),
    })),

  setTaper: (taper) =>
    set((state) => {
      const next = clamp(taper, TAPER_LIMITS)
      const base = state.structure.storeys[0]
      if (base === undefined) return { taper: next }
      return {
        taper: next,
        structure: withTaperedPlan(
          state.structure,
          base.widthX_m,
          base.widthY_m,
          next,
        ),
      }
    }),

  setAnchorCapacity: (anchorCapacity_kN) =>
    set((state) => ({
      structure: {
        ...state.structure,
        foundation: {
          ...state.structure.foundation,
          anchorCapacity_kN: clamp(anchorCapacity_kN, ANCHOR_CAPACITY_LIMITS_KN),
        },
      },
    })),

  setStoreyMaterial: (index, materialId) =>
    set((state) => ({ structure: withStorey(state.structure, index, { materialId }) })),

  setStoreySystem: (index, lateralSystem) =>
    set((state) => ({
      structure: withStorey(state.structure, index, { lateralSystem }),
    })),

  setAllMaterial: (materialId) =>
    set((state) => ({ structure: withAllStoreys(state.structure, { materialId }) })),

  setAllSystem: (lateralSystem) =>
    set((state) => ({
      structure: withAllStoreys(state.structure, { lateralSystem }),
    })),

  setStoreyFacade: (index, facade) =>
    set((state) => ({ structure: withStorey(state.structure, index, { facade }) })),

  setAllFacade: (facade) =>
    set((state) => ({ structure: withAllStoreys(state.structure, { facade }) })),

  loadDesign: (design) =>
    set({
      structure: design.structure,
      hazard: design.hazard,
      // Opening a design also moves the baseline to it. The question a student
      // has after opening someone else's work is "what did *my* changes do",
      // not "how does this differ from a default they never saw".
      baseline: {
        label: design.name,
        structure: design.structure,
        hazard: design.hazard,
      },
      // The loaded design has its own storeys; a selection pointing into the
      // previous one would highlight an unrelated floor.
      selectedStoreyIndex: null,
      // Read back off the widths the design actually carries, so the shape
      // control describes what is on screen rather than what the last design
      // happened to be set to.
      taper: deriveTaper(design.structure),
    }),

  pinBaseline: () =>
    set((state) => ({
      baseline: {
        label: 'Pinned design',
        structure: state.structure,
        hazard: state.hazard,
      },
    })),

  resetBaseline: () => set({ baseline: STARTING_BASELINE }),

  reset: () =>
    set({
      structure: DEFAULT_STRUCTURE,
      hazard: DEFAULT_HAZARD,
      baseline: STARTING_BASELINE,
      selectedStoreyIndex: null,
      taper: 0,
    }),
}))
