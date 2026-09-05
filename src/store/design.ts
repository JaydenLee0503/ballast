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
} from '@/lib/limits.ts'
import type { SavedDesign } from '@/persistence'
import type {
  ExposureCategory,
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

export interface DesignState {
  structure: Structure
  hazard: WindHazard
  /** Which storey the controls edit. `null` means "all storeys at once". */
  selectedStoreyIndex: number | null

  selectStorey: (index: number | null) => void

  setGustSpeed: (gustSpeed_kmh: number) => void
  setDirection: (directionDeg: number) => void
  setExposure: (category: ExposureCategory) => void

  addStorey: () => void
  removeStorey: () => void
  setPlanDimensions: (widthX_m: number, widthY_m: number) => void
  setAnchorCapacity: (anchorCapacity_kN: number) => void

  setStoreyMaterial: (index: number, materialId: string) => void
  setStoreySystem: (index: number, lateralSystem: LateralSystem) => void
  setAllMaterial: (materialId: string) => void
  setAllSystem: (lateralSystem: LateralSystem) => void

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

export const useDesignStore = create<DesignState>()((set) => ({
  structure: DEFAULT_STRUCTURE,
  hazard: DEFAULT_HAZARD,
  selectedStoreyIndex: null,

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
      // change the material or lateral system of the design.
      return {
        structure: { ...state.structure, storeys: [...storeys, { ...top }] },
      }
    }),

  removeStorey: () =>
    set((state) => {
      const storeys = state.structure.storeys
      if (storeys.length <= STOREY_COUNT_LIMITS.min) return state
      const next = storeys.slice(0, -1)
      return {
        structure: { ...state.structure, storeys: next },
        // Keep the selection pointing at a storey that still exists.
        selectedStoreyIndex:
          state.selectedStoreyIndex !== null &&
          state.selectedStoreyIndex >= next.length
            ? null
            : state.selectedStoreyIndex,
      }
    }),

  setPlanDimensions: (widthX_m, widthY_m) =>
    set((state) => ({
      // Uniform across the stack. The engine supports per-storey plans
      // (setbacks, tapers) but the UI does not expose them yet.
      structure: withAllStoreys(state.structure, {
        widthX_m: clamp(widthX_m, PLAN_WIDTH_LIMITS_M),
        widthY_m: clamp(widthY_m, PLAN_WIDTH_LIMITS_M),
      }),
    })),

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

  loadDesign: (design) =>
    set({
      structure: design.structure,
      hazard: design.hazard,
      // The loaded design has its own storeys; a selection pointing into the
      // previous one would highlight an unrelated floor.
      selectedStoreyIndex: null,
    }),

  reset: () =>
    set({
      structure: DEFAULT_STRUCTURE,
      hazard: DEFAULT_HAZARD,
      selectedStoreyIndex: null,
    }),
}))
