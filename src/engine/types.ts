/**
 * Ballast — engine domain types.
 *
 * This module (and everything else in `src/engine/`) is pure and
 * dependency-free. No React, no zustand, no Supabase, no I/O. Every exported
 * function is a deterministic pure function of its arguments: the same
 * structure + hazard must always produce byte-identical numbers, because
 * those numbers are the product's source of truth. The LLM layer reads these
 * results and explains them; it never produces them.
 *
 * Unit convention: every physical quantity carries its unit as a suffix on
 * the identifier. If you add a field without a unit suffix, it is either
 * dimensionless (say so in a comment) or it is a bug.
 */

/**
 * ASCE 7-16 surface roughness / exposure categories (§26.7.2-26.7.3).
 *   B — urban and suburban, wooded areas; numerous closely spaced obstructions.
 *   C — open terrain with scattered obstructions < 9.1 m. The default.
 *   D — flat unobstructed areas, water surfaces; smoothest, highest wind.
 */
export type ExposureCategory = 'B' | 'C' | 'D'

/** Lateral force resisting system for a storey. */
export type LateralSystem =
  | 'moment-frame'
  | 'braced-frame'
  | 'shear-wall'
  | 'none'

/**
 * The envelope hung on the frame — what a student sees as "windows".
 *
 * A real building is a structure plus a skin, and the skin is a large part of
 * both its carbon and its cost. It is also the choice that most changes what a
 * building *looks like*, which is why it belongs in the model rather than in
 * the renderer: a glass tower and a precast one should not differ only in
 * pixels.
 *
 * Each system carries a window-to-wall ratio, a carbon and cost intensity per
 * square metre of external wall, and a weight. See `FACADE` in constants.ts
 * for the values and where they come from.
 *
 * DELIBERATELY NOT STRUCTURAL. The facade hangs off the frame; the lateral
 * system in this model is a core or a braced/moment frame, not the perimeter
 * wall, so punching windows in it does not change stiffness or drift. It does
 * change *weight*, and weight is what resists overturning and sliding — so a
 * fully glazed tower is a lighter tower and a more tippable one. That is the
 * real consequence, and it is the one the engine models.
 */
export type FacadeSystem =
  /** No envelope at all. The zero case: what does a skin actually cost? */
  | 'exposed'
  /** Opaque spandrel wall with punched windows. Heavy, cheap, low glass. */
  | 'punched'
  /** Horizontal strip glazing between opaque bands. */
  | 'ribbon'
  /** Unitised aluminium-framed glazing, floor to floor. Light and expensive. */
  | 'curtain-wall'

export type FoundationType =
  | 'slab-on-grade'
  | 'strip-footing'
  | 'raft'
  | 'piled'

/**
 * Broad structural family. Drives the structural-volume fraction and the
 * plausibility warnings (e.g. rammed earth cannot form a moment frame).
 * Kept separate from `Material` so the `Material` shape stays minimal.
 */
export type StructuralClass =
  | 'concrete'
  | 'steel'
  | 'aluminium'
  | 'timber'
  | 'bamboo'
  | 'masonry'
  | 'earth'

/**
 * A structural material. Values are for the *solid* material, not for a
 * building assembly — the structural-volume fraction (see constants.ts)
 * converts gross building volume into solid-material volume.
 *
 * `yieldStrength_MPa` is the governing design strength in the sense relevant
 * to bending of the lateral system: yield stress for metals, characteristic
 * compressive strength for concrete/masonry/earth, characteristic bending
 * strength for engineered timber and bamboo. Documented per entry in
 * data/materials.json.
 */
export interface Material {
  id: string
  name: string
  density_kg_m3: number
  youngsModulus_GPa: number
  yieldStrength_MPa: number
  embodiedCarbon_kgCO2e_m3: number
  cost_usd_m3: number
}

/** Provenance for a library material. Not used in any calculation. */
export interface MaterialSources {
  density: string
  youngsModulus: string
  yieldStrength: string
  embodiedCarbon: string
  cost: string
}

/** A material as stored in the seed library: `Material` plus metadata. */
export interface MaterialEntry extends Material {
  structuralClass: StructuralClass
  /**
   * Confidence in `cost_usd_m3`. Cost is the weakest data in the library:
   * it is regional, volatile, and rarely published per cubic metre. Treat
   * 'indicative' values as order-of-magnitude only.
   */
  costConfidence: 'published' | 'indicative'
  sources: MaterialSources
}

export type MaterialLibrary = ReadonlyMap<string, MaterialEntry>

export interface Storey {
  height_m: number
  widthX_m: number
  widthY_m: number
  materialId: string
  lateralSystem: LateralSystem
  /**
   * Required, with no default anywhere in the engine. A storey with no stated
   * envelope would otherwise silently score as one with no envelope at all,
   * and "we forgot to ask" and "there is deliberately no cladding" must not
   * produce the same carbon number by accident.
   */
  facade: FacadeSystem
}

export interface Foundation {
  type: FoundationType
  embedmentDepth_m: number
  /** Total factored uplift capacity of the hold-down/anchor group. */
  anchorCapacity_kN: number
}

/** `storeys[0]` is the ground storey; the array reads bottom-to-top. */
export interface Structure {
  storeys: Storey[]
  foundation: Foundation
  exposureCategory: ExposureCategory
}

/**
 * A wind event. `gustSpeed_kmh` is the 3-second gust at 10 m in open terrain
 * (i.e. the basic wind speed V of ASCE 7, which the Kz profile then adjusts
 * to the actual exposure and height).
 */
export interface WindHazard {
  kind: 'wind'
  gustSpeed_kmh: number
  /** Meteorological-style bearing: 0 = wind blowing along +X, 90 = along +Y. */
  directionDeg: number
  /**
   * Aerodynamic roughness length z0 in metres. Used as a *consistency check*
   * against `exposureCategory`, not as an independent input to Kz — see
   * wind.ts `checkRoughnessConsistency`.
   */
  terrainRoughness: number
}

/**
 * Only wind is implemented. Seismic, flood and wildfire will join this union
 * with their own `kind`, so `analyze()` gains a branch rather than every call
 * site gaining a new function.
 */
export type Hazard = WindHazard

export type FailureMode =
  | 'overturning'
  | 'sliding'
  | 'drift'
  | 'storey-strength'
  | 'none'

/** Per-storey breakdown. The UI colours storeys by `utilization`. */
export interface StoreyResult {
  index: number
  /** Elevation of the storey's base above the foundation. */
  baseElevation_m: number
  midHeight_m: number
  height_m: number
  /** Velocity pressure exposure coefficient at this storey's mid-height. */
  Kz: number
  velocityPressure_Pa: number
  /** Windward face area of this storey for the given wind direction. */
  projectedArea_m2: number
  /** Wind force applied at this storey's mid-height. */
  lateralForce_kN: number
  /** Cumulative shear carried by this storey (sum of forces above + own). */
  storeyShear_kN: number
  materialVolume_m3: number
  /** Frame + facade. The facade share is broken out below. */
  selfWeight_kN: number
  /** Frame + facade, A1-A3. The facade share is broken out below. */
  embodiedCarbon_kgCO2e: number
  /** Frame + facade. The facade share is broken out below. */
  cost_usd: number
  /** External wall area of this storey: perimeter x height. No roof. */
  facadeArea_m2: number
  /**
   * The facade's share of the three totals above, so the split is auditable
   * on screen rather than inferable. Frame-only is total minus these.
   */
  facadeCarbon_kgCO2e: number
  facadeCost_usd: number
  facadeWeight_kN: number
  stiffness_kN_per_m: number
  drift_m: number
  /** drift_m / height_m, dimensionless. */
  driftRatio: number
  exceedsDriftLimit: boolean
  /** driftRatio / (1/500), dimensionless. > 1 means the limit is breached. */
  driftUtilization: number
  /** Bending stress demand / yield strength, dimensionless. */
  strengthUtilization: number
  /** max(driftUtilization, strengthUtilization). Drives storey colour. */
  utilization: number
}

export interface StabilityResult {
  baseShear_kN: number
  overturningMoment_kNm: number
  restoringMomentSelfWeight_kNm: number
  restoringMomentAnchorage_kNm: number
  restoringMoment_kNm: number
  factorOfSafetyOverturning: number
  slidingResistanceFriction_kN: number
  slidingResistancePassive_kN: number
  slidingResistance_kN: number
  factorOfSafetySliding: number
  totalSelfWeight_kN: number
  /** Plan dimension parallel to the wind, used as the overturning lever base. */
  alongWindDepth_m: number
  /** Plan dimension perpendicular to the wind (the windward face width). */
  acrossWindWidth_m: number
}

/**
 * Raw values only. Deliberately NOT a single 0-100 score: collapsing safety,
 * carbon and cost into one number hides the tradeoff that is the entire point
 * of the exercise. The UI shows three dials; the AI narrates the tension
 * between them.
 */
export interface ScoreCard {
  /** min(overturning FoS, sliding FoS). */
  safetyFactor: number
  carbonKg: number
  costUsd: number
  /** Worst storey drift ratio in the structure. */
  driftRatio: number
  governingFailureMode: FailureMode
}

export interface AnalysisResult {
  hazardKind: Hazard['kind']
  storeys: StoreyResult[]
  stability: StabilityResult
  scoreCard: ScoreCard
  /**
   * Non-fatal modelling caveats: inconsistent roughness, implausible
   * material/system pairings, values outside the calibration range. Surface
   * these to the student; they are the honest edges of the model.
   */
  warnings: string[]
}
