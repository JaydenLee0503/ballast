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

/**
 * What kind of building this is.
 *
 * A *stated* classification, in the same sense as `exposureCategory`: it is
 * something the student declares, not something the geometry implies. The
 * engine does not read it — every number still comes from `storeys`,
 * `foundation` and the hazard — and it is carried on `Structure` because it is
 * part of the design somebody saves and shares, and because it is the natural
 * hook for occupancy loading if live loads are ever added.
 *
 * It must never become a shortcut for a number. If a stadium one day needs
 * different physics, that is a new structural form with its own load path and
 * its own tests, not a coefficient looked up from this field. A typology that
 * silently changed a safety factor would be exactly the failure the whole
 * "the engine computes" rule exists to prevent.
 *
 * `'custom'` is the honest absence: a design that was freely edited, or one
 * loaded from before typologies existed. It claims nothing.
 */
export type Typology =
  | 'custom'
  | 'house'
  | 'townhouse'
  | 'apartment-block'
  | 'office-tower'
  | 'warehouse'
  | 'school'

/**
 * The footprint a storey is idealised as.
 *
 * A REAL INPUT, not a rendering choice. Every place the engine touches plan
 * geometry asks this question and answers it differently: floor and material
 * volume (`pi/4` of the enclosing rectangle for an ellipse), envelope area (an
 * elliptical perimeter, not a rectangular one), the silhouette the wind sees at
 * a given bearing, the section modulus the storey bends over, and — the one a
 * student is meant to notice — the force coefficient, because a round building
 * sheds wind that a square one catches. See `plan.ts`, which owns all of it.
 *
 * `'ellipse'` covers the circle: equal widths make one. There is no separate
 * circle member, because a circle is not a different calculation and a second
 * name for the same formula is a second thing to keep in step.
 *
 * WHAT IT IS NOT. It is not a curved *structure*. An arch, a vault and a dome
 * carry load along a curve into abutments, and this engine has no such load
 * path — see `lib/typology.ts` and the blueprint caveats. An elliptical plan is
 * still a storey resisting wind as a vertical cantilever; only its cross-section
 * has changed.
 */
export type PlanShape = 'rectangle' | 'ellipse'

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
  /**
   * The plan dimensions. For `planShape: 'ellipse'` these are the full axes of
   * the ellipse — the box it is inscribed in — so the same two sliders describe
   * both shapes and switching between them keeps the building the same size.
   */
  widthX_m: number
  widthY_m: number
  /**
   * Required, with no default in the engine, for the same reason `facade` is:
   * a storey with no stated footprint would silently score as a rectangle, and
   * "we forgot to ask" must not produce a number by accident.
   */
  planShape: PlanShape
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
  /**
   * Declared building kind. Not read by the engine — see `Typology`. It drives
   * the archetype presets and the roof the viewport draws, and nothing else.
   */
  typology: Typology
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
 * ASCE 7-16 site classes (Table 20.3-1), by the stiffness of the soil the
 * building stands on. A is hard rock, E is soft clay. The class does not
 * change the ground motion on the map; it changes how much of it arrives at
 * the foundation, and soft soil amplifies it — which is the lesson.
 *
 * F (soils requiring site-specific evaluation) is deliberately absent: ASCE 7
 * forbids the tabulated coefficients there, so offering it would mean either
 * refusing to produce a number or inventing one.
 */
export type SiteClass = 'A' | 'B' | 'C' | 'D' | 'E'

/**
 * An earthquake, described the way ASCE 7 describes one: not as a magnitude
 * but as the mapped spectral response acceleration at the site.
 *
 * `Ss_g` and `S1_g` are the risk-targeted maximum considered earthquake
 * (MCE_R) 5%-damped spectral accelerations at short period and at one second,
 * as fractions of gravity (ASCE 7-16 §11.4.2, read off the Fig. 22-1..22-8
 * maps). They are the *site's* seismicity — a student picks somewhere hazardous
 * or somewhere quiet — and `siteClass` then says what the soil does to it.
 *
 * Magnitude is deliberately not an input. A magnitude is a property of a
 * rupture hundreds of kilometres away and nothing in this engine could turn it
 * into a force without inventing a distance, a fault mechanism and an
 * attenuation relationship.
 */
export interface SeismicHazard {
  kind: 'seismic'
  /** MCE_R spectral acceleration at short periods, in g. */
  Ss_g: number
  /** MCE_R spectral acceleration at a 1 s period, in g. */
  S1_g: number
  siteClass: SiteClass
  /**
   * Which way the ground moves, in the same plan frame as the wind: 0 = along
   * +X, 90 = along +Y. An earthquake shakes in every direction at once, and
   * this engine evaluates one at a time — see `seismic.ts`.
   */
  directionDeg: number
}

/**
 * A flood: still water standing against the building, moving past it.
 *
 * `depth_m` is the stillwater depth above grade (ASCE 7-16 §5.4.1), i.e. how
 * far up the walls the water stands. `velocity_ms` is the depth-averaged flow
 * velocity. Together they give the two loads that matter — hydrostatic, which
 * grows with the square of depth, and hydrodynamic, which grows with the square
 * of velocity — plus the one that surprises students, buoyancy.
 *
 * NOT A WATER LEVEL ON A MAP. There is no site datum here: depth is measured
 * from the foundation's ground level, because that is the only elevation the
 * engine knows.
 */
export interface FloodHazard {
  kind: 'flood'
  /** Stillwater depth above grade. */
  depth_m: number
  /** Depth-averaged flow velocity. 0 is standing water. */
  velocity_ms: number
  /** Direction of flow, in the plan frame: 0 = towards +X, 90 = towards +Y. */
  directionDeg: number
}

/**
 * The hazards this engine can analyse.
 *
 * `analyze()` dispatches on `kind`, so a fourth (wildfire was always the next
 * candidate) joins here and gains a branch rather than every call site gaining
 * a function. What the three have in common is the shape of the answer: a
 * lateral force per storey, accumulated into shears and a base moment, checked
 * against overturning, sliding, drift and storey bending. What differs is where
 * the load comes from and where on the building it lands — wind loads the top,
 * an earthquake loads the mass, a flood loads the bottom and tries to float the
 * whole thing.
 */
export type Hazard = WindHazard | SeismicHazard | FloodHazard

export type FailureMode =
  | 'overturning'
  | 'sliding'
  | 'drift'
  | 'storey-strength'
  /** Flood only: buoyancy exceeds the weight holding the building down. */
  | 'flotation'
  | 'none'

/**
 * How badly one storey came out of the event.
 *
 * A *banding of `utilization`*, in exactly the sense `lib/palette.ts` bands the
 * same number into three colours — not a second opinion about it. It lives in
 * the engine rather than in the viewport because "this storey collapsed" is a
 * claim about the building, and claims about the building come from here.
 *
 * See `DAMAGE_THRESHOLDS` in constants.ts for where the boundaries come from
 * and why the top one is called 'collapsed' rather than given a number.
 */
export type DamageState = 'intact' | 'cracked' | 'severe' | 'collapsed'

/** How the building as a whole came out of it. */
export type SurvivalVerdict = 'stands' | 'damaged' | 'failed'

/**
 * What the simulation is allowed to draw.
 *
 * Derived, like everything else here, from figures `analyze()` already
 * produced: per-storey `utilization` bands into a `DamageState`, and the
 * global checks decide the verdict. The 3D view reads this and nothing else
 * when it shows damage, so a cracked storey on screen is a storey the engine
 * says is over its limit.
 */
export interface DamageReport {
  verdict: SurvivalVerdict
  /** Parallel to `storeys`, bottom-to-top. */
  storeys: DamageState[]
  /**
   * Index of the lowest storey the engine calls collapsed, or null. Everything
   * above it is unsupported, which is what the viewport drops.
   */
  collapseIndex: number | null
  /** One plain sentence naming what gave way. Copy, not a calculation. */
  headline: string
}

/** Per-storey breakdown. The UI colours storeys by `utilization`. */
export interface StoreyResult {
  index: number
  /** Elevation of the storey's base above the foundation. */
  baseElevation_m: number
  midHeight_m: number
  height_m: number
  /**
   * Velocity pressure exposure coefficient at this storey's mid-height, and
   * the pressure it produces.
   *
   * WIND ONLY, and therefore optional. An earthquake and a flood have no
   * velocity pressure, and reporting 0 for them would be a number about a
   * quantity that does not exist — the same failure as inventing one, pointing
   * the other way. Absent means "this hazard has no such figure".
   */
  Kz?: number
  velocityPressure_Pa?: number
  /**
   * FLOOD ONLY: how far up this storey the water stands, 0 above the surface.
   */
  submergedDepth_m?: number
  /** FLOOD ONLY: the uplift this storey's displaced volume generates. */
  buoyancy_kN?: number
  /** The loaded face area of this storey for the hazard's direction. */
  projectedArea_m2: number
  /**
   * Elevation above the foundation at which this storey's lateral force acts.
   *
   * Mid-height for wind and for an earthquake, where the load is spread over
   * the whole storey. For a flood it is the centroid of the *submerged* part,
   * which sits low in a partly flooded storey — and that lower lever arm is
   * why a flood is a sliding problem long before it is an overturning one.
   */
  loadElevation_m: number
  /** Lateral force from the hazard, applied at `loadElevation_m`. */
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
  /** The band of `utilization` the simulation draws. See `DamageState`. */
  damage: DamageState
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
  /**
   * FLOOD ONLY: total buoyant uplift on the submerged volume, and the weight
   * left over to resist overturning and sliding once it is subtracted.
   */
  buoyancy_kN?: number
  effectiveWeight_kN?: number
  /**
   * FLOOD ONLY: weight / buoyancy. Below 1.0 the building floats, which is a
   * failure no amount of bracing fixes.
   */
  factorOfSafetyFlotation?: number
  /** Plan dimension parallel to the load, used as the overturning lever base. */
  alongWindDepth_m: number
  /** Plan dimension perpendicular to the load (the loaded face width). */
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
   * The drift limit this analysis was checked against, dimensionless.
   *
   * It is not a constant across hazards: wind is a serviceability check at
   * h/500, while ASCE 7-16 Table 12.12-1 allows 0.020h under the design
   * earthquake because the building is expected to yield. Reported here so the
   * panel can print the limit it actually used rather than assume one.
   */
  driftLimitRatio: number
  /** What the simulation draws. Bands of figures already in `storeys`. */
  damage: DamageReport
  /**
   * Non-fatal modelling caveats: inconsistent roughness, implausible
   * material/system pairings, values outside the calibration range. Surface
   * these to the student; they are the honest edges of the model.
   */
  warnings: string[]
}
