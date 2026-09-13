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
  EMBEDMENT_DEPTH_LIMITS_M,
  FLOOD_DEPTH_LIMITS_M,
  FLOW_VELOCITY_LIMITS_MS,
  GUST_SPEED_LIMITS_KMH,
  PLAN_WIDTH_LIMITS_M,
  SEISMIC_S1_LIMITS_G,
  SEISMIC_SS_LIMITS_G,
  STOREY_COUNT_LIMITS,
  STOREY_HEIGHT_LIMITS_M,
  TAPER_LIMITS,
} from '@/lib/limits.ts'
import type { SavedDesign } from '@/persistence'
import type {
  ExposureCategory,
  FacadeSystem,
  FloodHazard,
  Hazard,
  LateralSystem,
  PlanShape,
  SeismicHazard,
  SiteClass,
  Storey,
  Structure,
  Typology,
  WindHazard,
} from '@/engine'
import { archetype, structureFor } from '@/lib/typology.ts'
import type { Blueprint } from '@/ai/blueprint/parse.ts'

/**
 * Starting point: a mid-rise CLT block. Chosen because it sits in the
 * interesting part of the design space — comfortably safe in a normal gale,
 * and in trouble by the top of the gust slider, so the first thing a student
 * does reveals the tradeoff rather than a wall of green.
 */
export const DEFAULT_STRUCTURE: Structure = {
  // 'custom' rather than 'apartment-block': this is its own shape, not the
  // apartment archetype, and claiming otherwise would put a typology on a
  // design nobody chose one for.
  typology: 'custom',
  storeys: Array.from({ length: 6 }, () => ({
    height_m: 3.5,
    widthX_m: 18,
    widthY_m: 12,
    materialId: 'cross-laminated-timber',
    lateralSystem: 'shear-wall' as const,
    facade: 'punched' as const,
    planShape: 'rectangle' as const,
  })),
  foundation: { type: 'raft', embedmentDepth_m: 1.5, anchorCapacity_kN: 600 },
  exposureCategory: 'C',
}

export const DEFAULT_WIND_HAZARD: WindHazard = {
  kind: 'wind',
  gustSpeed_kmh: 150,
  directionDeg: 0,
  // 0.02 m is open terrain, the roughness the engine associates with
  // Exposure C — consistent with DEFAULT_STRUCTURE, so no warning on load.
  terrainRoughness: 0.02,
}

/**
 * A serious but not extraordinary earthquake: roughly what the ASCE 7 maps show
 * for Seattle or Salt Lake City rather than for a near-fault site in
 * California, on the stiff soil most buildings sit on.
 *
 * Chosen the same way the 150 km/h gust was, and against the same test: the
 * design the studio opens with should have to work for it without everything
 * being red on arrival. At these accelerations the starting CLT block comes out
 * just over the drift limit — so clicking "Earthquake" immediately shows the
 * lesson the three hazards exist for (the block that sails through a gale does
 * not sail through a quake), and widening the plan, bracing it, or taking a
 * floor off all get it back. The top of the slider is the near-fault case, and
 * that one is genuinely hard, which is honest.
 */
export const DEFAULT_SEISMIC_HAZARD: SeismicHazard = {
  kind: 'seismic',
  Ss_g: 0.8,
  S1_g: 0.3,
  siteClass: 'D',
  directionDeg: 0,
}

/**
 * Two metres of moving water: a bad riverine flood, above the ground floor and
 * well inside the range where the model is honest. Deep enough that a light
 * building starts to float, which is the lesson this hazard is here for.
 */
export const DEFAULT_FLOOD_HAZARD: FloodHazard = {
  kind: 'flood',
  depth_m: 2,
  velocity_ms: 1.5,
  directionDeg: 0,
}

/**
 * The hazard the studio opens with.
 *
 * Deliberately typed as the wind hazard it is rather than widened to `Hazard`:
 * everything that reaches for "the default" — the starting baseline, the
 * fixtures, `reset()` — wants the storm specifically, and widening the type
 * here would make every one of them narrow it again at the call site.
 */
export const DEFAULT_HAZARD = DEFAULT_WIND_HAZARD

/**
 * The settings each hazard is remembered at while another one is selected.
 *
 * Switching from a 250 km/h gale to a flood and back should return the gale,
 * not the default. A student comparing how one building copes with three
 * different events is doing exactly the thing this app is for, and making them
 * re-dial the storm each time would quietly discourage it.
 *
 * Keyed by kind, so the store holds one live `hazard` — which is what the
 * analysis memoises on — plus the two that are currently set aside.
 */
export interface HazardSettings {
  wind: WindHazard
  seismic: SeismicHazard
  flood: FloodHazard
}

export const DEFAULT_HAZARD_SETTINGS: HazardSettings = {
  wind: DEFAULT_WIND_HAZARD,
  seismic: DEFAULT_SEISMIC_HAZARD,
  flood: DEFAULT_FLOOD_HAZARD,
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
  hazard: Hazard
}

export const STARTING_BASELINE: Baseline = {
  label: 'Starting design',
  structure: DEFAULT_STRUCTURE,
  hazard: DEFAULT_HAZARD,
}

export interface DesignState {
  structure: Structure
  hazard: Hazard
  /**
   * The other two hazards, at whatever the student last set them to. See
   * `HazardSettings`. Never analysed — only `hazard` is.
   */
  hazardSettings: HazardSettings
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

  /**
   * Swap which hazard the building is being analysed against.
   *
   * The *structure* is deliberately untouched. The whole point of three hazards
   * is that the same building meets all of them: a tall light tower that sails
   * through a flood is the one an earthquake finds easiest to shake, and you
   * only see that if the design stays put while the event changes.
   *
   * The hazard being replaced is stashed in `hazardSettings` so coming back to
   * it returns the storm the student dialled rather than the default one.
   */
  setHazardKind: (kind: Hazard['kind']) => void

  /** Wind only. A no-op under another hazard rather than a type error. */
  setGustSpeed: (gustSpeed_kmh: number) => void
  /** Every hazard has a bearing: the gust, the shaking and the current. */
  setDirection: (directionDeg: number) => void
  setExposure: (category: ExposureCategory) => void

  /** Seismic only: the mapped accelerations, and what the soil does to them. */
  setSeismicAcceleration: (Ss_g: number, S1_g: number) => void
  setSiteClass: (siteClass: SiteClass) => void

  /** Flood only. */
  setFloodDepth: (depth_m: number) => void
  setFlowVelocity: (velocity_ms: number) => void

  addStorey: () => void
  removeStorey: () => void
  /**
   * Size the plan. With no storey selected this sets the *ground* storey and the
   * taper spreads it up the stack; with one selected it sizes that storey alone.
   *
   * The same "selection is the target" idiom the material, system and envelope
   * controls already use, extended to shape. A `Storey` has always carried its
   * own width and the engine has always read it per storey — what was missing
   * was a way to say so with a slider, which is why every design used to be a
   * prism or a cone and nothing else.
   */
  setPlanDimensions: (widthX_m: number, widthY_m: number, index?: number) => void

  /**
   * Floor-to-floor height, on every storey or on the selected one.
   *
   * It exists at all because storey count is not a height control — a one-storey
   * arena and a three-storey office can want the same 24 m and mean completely
   * different buildings. Per-storey because that is what a hall with offices
   * over it *is*: one tall volume and some ordinary floors.
   */
  setStoreyHeight: (height_m: number, index?: number) => void
  setAnchorCapacity: (anchorCapacity_kN: number) => void

  /** Regenerate every storey's plan from the ground storey and this taper. */
  setTaper: (taper: number) => void

  /**
   * Replace the design with an archetype's starting point.
   *
   * The typology it stamps then *stays* until another is chosen — editing the
   * shape afterwards does not silently revert it to 'custom'. A typology is a
   * declaration ("this is a house"), not a description of the current
   * geometry, so adding a floor to a house leaves it a house. The visible
   * consequence is that the roof form persists too.
   */
  setTypology: (typology: Typology) => void

  /**
   * Replace the design with one the AI proposed from a description.
   *
   * The same kind of write as `setTypology`: a starting point, not a mode.
   * Nothing downstream can tell a blueprint from an archetype or from a design
   * built by hand — it is storeys, a foundation and an exposure — so every
   * control still works on it afterwards and `analyze()` scores it the same way.
   * What arrives here has already been through `parseBlueprint`, which checked
   * every id against the real library and pulled every number into the editing
   * limits; the clamps below are the same belt-and-braces `structureFor` keeps.
   *
   * The hazard is deliberately untouched. The storm is the student's half of the
   * exercise, and a proposal that also turned the wind up would change two
   * things at once and make the first reading unattributable.
   */
  applyBlueprint: (blueprint: Blueprint) => void

  /**
   * Rectangle or ellipse, on one storey or on all of them.
   *
   * A real change of design, not a change of drawing: the engine reads the
   * footprint for floor area, envelope area, the face the wind meets, the
   * section the storey bends over and the force coefficient. A round tower is
   * lighter, cheaper, lower-carbon, less stiff and catches roughly half the
   * wind — every one of those from `analyze()`, none of them from here.
   */
  setPlanShape: (planShape: PlanShape, index?: number) => void

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

/**
 * Whether every storey's plan is still what (ground storey, taper) generates.
 *
 * The question `retaper` has to ask before it acts. A stack that the taper
 * control produced should stay a taper when a floor is added — a tapered tower
 * growing a straight extension looks like a bug. A stack the student shaped
 * storey by storey must not be regenerated at all, because that would silently
 * throw their work away on the next press of "Add".
 *
 * Compared at the precision the widths are stored to, so a re-derived taper that
 * rounds a millimetre differently still counts as generated.
 */
function isGeneratedTaper(structure: Structure, taper: number): boolean {
  const base = structure.storeys[0]
  if (base === undefined) return true
  const generated = withTaperedPlan(structure, base.widthX_m, base.widthY_m, taper)
  return structure.storeys.every((storey, i) => {
    const want = generated.storeys[i]
    return (
      want !== undefined &&
      Math.abs(storey.widthX_m - want.widthX_m) <= 0.05 &&
      Math.abs(storey.widthY_m - want.widthY_m) <= 0.05
    )
  })
}

/**
 * Re-apply the current taper across a changed storey count.
 *
 * `wasGenerated` is read from the stack as it was *before* the count changed,
 * because the changed one never matches — a copy of the top storey is by
 * definition not what a taper over one more floor would produce.
 */
function retaper(
  structure: Structure,
  taper: number,
  wasGenerated: boolean,
): Structure {
  const base = structure.storeys[0]
  if (base === undefined || !wasGenerated) return structure
  return withTaperedPlan(structure, base.widthX_m, base.widthY_m, taper)
}

export const useDesignStore = create<DesignState>()((set, get) => ({
  structure: DEFAULT_STRUCTURE,
  hazard: DEFAULT_HAZARD,
  hazardSettings: DEFAULT_HAZARD_SETTINGS,
  baseline: STARTING_BASELINE,
  selectedStoreyIndex: null,
  taper: 0,

  selectStorey: (index) => set({ selectedStoreyIndex: index }),

  setHazardKind: (kind) =>
    set((state) => {
      if (kind === state.hazard.kind) return state
      return {
        // Put the outgoing hazard back in the drawer, take the incoming one
        // out. Both halves in one update, so the two can never disagree about
        // which hazard is live.
        hazardSettings: { ...state.hazardSettings, [state.hazard.kind]: state.hazard },
        hazard: state.hazardSettings[kind],
      }
    }),

  setGustSpeed: (gustSpeed_kmh) =>
    set((state) => {
      // Guarded rather than typed away: the controls only render this slider
      // for a wind hazard, and a store action that silently wrote a gust speed
      // onto a flood would be a bug nothing caught.
      if (state.hazard.kind !== 'wind') return state
      return {
        hazard: {
          ...state.hazard,
          gustSpeed_kmh: clamp(gustSpeed_kmh, GUST_SPEED_LIMITS_KMH),
        },
      }
    }),

  setSeismicAcceleration: (Ss_g, S1_g) =>
    set((state) => {
      if (state.hazard.kind !== 'seismic') return state
      return {
        hazard: {
          ...state.hazard,
          Ss_g: clamp(Ss_g, SEISMIC_SS_LIMITS_G),
          S1_g: clamp(S1_g, SEISMIC_S1_LIMITS_G),
        },
      }
    }),

  setSiteClass: (siteClass) =>
    set((state) => {
      if (state.hazard.kind !== 'seismic') return state
      return { hazard: { ...state.hazard, siteClass } }
    }),

  setFloodDepth: (depth_m) =>
    set((state) => {
      if (state.hazard.kind !== 'flood') return state
      return {
        hazard: { ...state.hazard, depth_m: clamp(depth_m, FLOOD_DEPTH_LIMITS_M) },
      }
    }),

  setFlowVelocity: (velocity_ms) =>
    set((state) => {
      if (state.hazard.kind !== 'flood') return state
      return {
        hazard: {
          ...state.hazard,
          velocity_ms: clamp(velocity_ms, FLOW_VELOCITY_LIMITS_MS),
        },
      }
    }),

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
          isGeneratedTaper(state.structure, state.taper),
        ),
      }
    }),

  removeStorey: () =>
    set((state) => {
      const storeys = state.structure.storeys
      if (storeys.length <= STOREY_COUNT_LIMITS.min) return state
      const next = storeys.slice(0, -1)
      const wasGenerated = isGeneratedTaper(state.structure, state.taper)
      return {
        structure: retaper(
          { ...state.structure, storeys: next },
          state.taper,
          wasGenerated,
        ),
        // Keep the selection pointing at a storey that still exists.
        selectedStoreyIndex:
          state.selectedStoreyIndex !== null &&
          state.selectedStoreyIndex >= next.length
            ? null
            : state.selectedStoreyIndex,
      }
    }),

  setPlanDimensions: (widthX_m, widthY_m, index) =>
    set((state) => {
      const widths = {
        widthX_m: clamp(round1(widthX_m), PLAN_WIDTH_LIMITS_M),
        widthY_m: clamp(round1(widthY_m), PLAN_WIDTH_LIMITS_M),
      }
      if (index === undefined) {
        // No selection: the slider sets the ground storey and the taper spreads
        // it up the stack, which is what it has always done.
        return {
          structure: withTaperedPlan(
            state.structure,
            widths.widthX_m,
            widths.widthY_m,
            state.taper,
          ),
        }
      }
      // One storey: the stack stops being a clean linear taper, so the taper
      // control is re-read off the result rather than left claiming a shape the
      // building no longer has. Same treatment `loadDesign` gives a design it
      // did not generate, and the next drag of the control imposes a taper again.
      const structure = withStorey(state.structure, index, widths)
      return { structure, taper: deriveTaper(structure) }
    }),

  setStoreyHeight: (height_m, index) =>
    set((state) => {
      const change = { height_m: clamp(height_m, STOREY_HEIGHT_LIMITS_M) }
      return {
        structure:
          index === undefined
            ? withAllStoreys(state.structure, change)
            : withStorey(state.structure, index, change),
      }
    }),

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

  setTypology: (typology) => {
    const entry = archetype(typology)
    // 'custom' has no archetype and generates nothing: it is what a design
    // *becomes* by being edited, not something you can build from.
    if (entry === undefined) {
      set((state) => ({ structure: { ...state.structure, typology } }))
      return
    }
    set({
      structure: structureFor(entry),
      selectedStoreyIndex: null,
      // The preset writes prismatic storeys, so the shape control has to agree.
      taper: 0,
    })
  },

  applyBlueprint: (blueprint) => {
    // Truncated rather than refused if a future parser ever hands over more than
    // the controls hold; the parser already caps it, and this is the same
    // belt-and-braces `structureFor` keeps.
    const proposed = blueprint.storeys.slice(0, STOREY_COUNT_LIMITS.max)
    const structure: Structure = {
      typology: blueprint.typology,
      storeys: proposed.map((storey) => ({
        ...storey,
        height_m: clamp(storey.height_m, STOREY_HEIGHT_LIMITS_M),
        widthX_m: clamp(storey.widthX_m, PLAN_WIDTH_LIMITS_M),
        widthY_m: clamp(storey.widthY_m, PLAN_WIDTH_LIMITS_M),
      })),
      foundation: {
        type: blueprint.foundationType,
        embedmentDepth_m: clamp(blueprint.embedmentDepth_m, EMBEDMENT_DEPTH_LIMITS_M),
        anchorCapacity_kN: clamp(
          blueprint.anchorCapacity_kN,
          ANCHOR_CAPACITY_LIMITS_KN,
        ),
      },
      exposureCategory: blueprint.exposureCategory,
    }
    // A taper is a rule about how *one* plan changes with height, so it only
    // applies to a proposal that is one plan. A stack of sections — a hall with
    // tiers over it — already carries its own shape, and regenerating its widths
    // from the ground storey would flatten the thing the model was asked for.
    const ground = structure.storeys[0]
    const uniformPlan = structure.storeys.every(
      (storey) =>
        storey.widthX_m === ground?.widthX_m && storey.widthY_m === ground?.widthY_m,
    )
    const taper = uniformPlan ? clamp(blueprint.taper, TAPER_LIMITS) : 0
    // Widths are generated here rather than carried in the blueprint, so there
    // is one implementation of "a taper becomes per-storey widths".
    const tapered = uniformPlan
      ? withTaperedPlan(
          structure,
          ground?.widthX_m ?? PLAN_WIDTH_LIMITS_M.min,
          ground?.widthY_m ?? PLAN_WIDTH_LIMITS_M.min,
          taper,
        )
      : structure
    set({
      structure: tapered,
      // For a sectioned stack this is the closest linear read of what is on
      // screen, the same thing `loadDesign` shows for a design it did not
      // generate — the control has to describe something, and 0 would be a lie.
      taper: uniformPlan ? taper : deriveTaper(tapered),
      selectedStoreyIndex: null,
      // The proposal becomes the thing the student's own edits are measured
      // against, exactly as opening a saved design does: after starting from a
      // generated arena the useful question is "what did *my* changes do", not
      // "how does this differ from a CLT block they never asked for". The same
      // structure object goes into both, so the first reading shows no deltas.
      baseline: {
        label: blueprint.name,
        structure: tapered,
        hazard: get().hazard,
      },
    })
  },

  setPlanShape: (planShape, index) =>
    set((state) => ({
      structure:
        index === undefined
          ? withAllStoreys(state.structure, { planShape })
          : withStorey(state.structure, index, { planShape }),
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
    set((state) => ({
      structure: design.structure,
      hazard: design.hazard,
      // The design's own hazard becomes what switching away and back returns
      // to, so opening a flood design and glancing at the wind does not lose
      // the flood the design was built for.
      hazardSettings: {
        ...state.hazardSettings,
        [design.hazard.kind]: design.hazard,
      },
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
    })),

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
      hazardSettings: DEFAULT_HAZARD_SETTINGS,
      baseline: STARTING_BASELINE,
      selectedStoreyIndex: null,
      taper: 0,
    }),
}))
