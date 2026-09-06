/**
 * Engine constants: code coefficients, lookup tables and calibration factors.
 *
 * Every number here is either (a) taken from a published standard, cited
 * inline, or (b) an explicit calibration constant whose calibration basis is
 * stated. There are no unexplained magic numbers in this file, and there must
 * never be — if you add one, cite it or explain how you tuned it.
 */

import type {
  ExposureCategory,
  FacadeSystem,
  FoundationType,
  LateralSystem,
  StructuralClass,
} from './types.ts'

// ---------------------------------------------------------------------------
// Domain enumerations
// ---------------------------------------------------------------------------

/**
 * The union members of the domain enums, as runtime arrays.
 *
 * The types in types.ts vanish at compile time, so anything that has to make
 * a decision about a value it did not construct itself — a `<select>` filling
 * its options, a parser deciding whether a saved design is loadable — needs
 * the list to exist at runtime. Without these it gets rebuilt by hand at each
 * call site, and the copies drift.
 *
 * `exhaustiveList` checks both directions: a member that is not in the union
 * fails the `readonly Union[]` constraint, and a union member missing from the
 * array makes the parameter type `never`, so the call stops compiling. Add a
 * lateral system to the union and this file breaks until the array knows.
 */
function exhaustiveList<Union extends string>() {
  return <const T extends readonly Union[]>(
    values: [Union] extends [T[number]] ? T : never,
  ): T => values
}

export const LATERAL_SYSTEMS = exhaustiveList<LateralSystem>()([
  'shear-wall',
  'braced-frame',
  'moment-frame',
  'none',
])

export const EXPOSURE_CATEGORIES = exhaustiveList<ExposureCategory>()([
  'B',
  'C',
  'D',
])

export const FOUNDATION_TYPES = exhaustiveList<FoundationType>()([
  'slab-on-grade',
  'strip-footing',
  'raft',
  'piled',
])

export const FACADE_SYSTEMS = exhaustiveList<FacadeSystem>()([
  'exposed',
  'punched',
  'ribbon',
  'curtain-wall',
])

// ---------------------------------------------------------------------------
// Facade: envelope assemblies
// ---------------------------------------------------------------------------

/**
 * What one square metre of external wall costs, weighs and emits.
 *
 * PROVENANCE, stated plainly because it is weaker than the ASCE coefficients
 * above and must not be mistaken for them. These are *assembly-level*
 * order-of-magnitude figures for four common curtain-wall / cladding
 * archetypes, in the ranges published EPDs and cost benchmarks put them in:
 *
 *   - Unitised aluminium-framed glazing runs roughly 140-200 kgCO2e/m2 A1-A3,
 *     dominated by the aluminium (about 8-13 kgCO2e per kg of extrusion at
 *     typical recycled content, over roughly 15 kg/m2 of frame) with the
 *     insulating glass unit adding 25-40. It weighs 50-75 kg/m2.
 *   - A precast or masonry spandrel wall with punched windows is heavier by
 *     an order of magnitude (a 150 mm precast panel alone is about 360 kg/m2)
 *     and lower in carbon per m2, because concrete is far less carbon-intense
 *     per kilogram than aluminium even though there is much more of it.
 *   - Ribbon glazing is taken as the midpoint of the two, because it is
 *     literally half of each.
 *
 * They are NOT quantity-surveyed, NOT regional, and NOT from a named EPD.
 * `analyze()` raises a warning whenever a design uses any of them, in the same
 * spirit as the cost warning: good enough to teach the tradeoff, not good
 * enough to quote. Treat a 10% difference between two facades as noise and a
 * 3x difference as real.
 *
 * `windowToWallRatio` is dimensionless, 0 = blank wall, 1 = all glass. It is
 * the one field here that is not an estimate — it is the definition of each
 * archetype, and it is what the viewport draws.
 */
export interface FacadeProperties {
  /** Dimensionless, 0..1: glazed fraction of the external wall. */
  readonly windowToWallRatio: number
  /** A1-A3, per m2 of external wall. */
  readonly embodiedCarbon_kgCO2e_m2: number
  /** Indicative supply-and-install rate, per m2 of external wall. */
  readonly cost_usd_m2: number
  /**
   * Dead load per m2 of external wall. This is what makes the facade a
   * structural question: it is the only way the envelope reaches the
   * stability check, and it pushes overturning and sliding the *helpful* way.
   */
  readonly selfWeight_kN_m2: number
}

export const FACADE: Readonly<Record<FacadeSystem, FacadeProperties>> = {
  // The zero case. Not a building anyone can occupy; it is here so a student
  // can switch the envelope off and read what it was contributing.
  exposed: {
    windowToWallRatio: 0,
    embodiedCarbon_kgCO2e_m2: 0,
    cost_usd_m2: 0,
    selfWeight_kN_m2: 0,
  },
  // Precast/masonry spandrel with punched aluminium windows.
  punched: {
    windowToWallRatio: 0.3,
    embodiedCarbon_kgCO2e_m2: 95,
    cost_usd_m2: 450,
    selfWeight_kN_m2: 3.6,
  },
  // Horizontal strip glazing: about half glass, half opaque spandrel.
  ribbon: {
    windowToWallRatio: 0.55,
    embodiedCarbon_kgCO2e_m2: 130,
    cost_usd_m2: 650,
    selfWeight_kN_m2: 1.9,
  },
  // Unitised aluminium-framed IGU, floor to floor.
  'curtain-wall': {
    windowToWallRatio: 0.85,
    embodiedCarbon_kgCO2e_m2: 175,
    cost_usd_m2: 950,
    selfWeight_kN_m2: 0.6,
  },
}

// ---------------------------------------------------------------------------
// Wind: ASCE 7-16 coefficients
// ---------------------------------------------------------------------------

/**
 * Velocity pressure constant in SI. ASCE 7-16 Eq. 26.10-1:
 *   qz = 0.613 * Kz * Kzt * Kd * V^2   [Pa, with V in m/s]
 * The 0.613 is 0.5 * rho_air with rho = 1.225 kg/m^3 (air at 15 degC,
 * sea level) — i.e. it is simply the dynamic pressure 0.5*rho*V^2.
 */
export const VELOCITY_PRESSURE_CONSTANT = 0.613

/**
 * Wind directionality factor Kd. ASCE 7-16 Table 26.6-1, "Buildings — Main
 * Wind Force Resisting System" = 0.85. It accounts for the low probability
 * that the worst wind direction coincides with the worst structural
 * orientation.
 */
export const KD_DIRECTIONALITY = 0.85

/**
 * Topographic factor Kzt. ASCE 7-16 §26.8.2: Kzt = 1.0 for structures not on
 * an abrupt hill, ridge or escarpment.
 *
 * ASSUMPTION: Ballast places buildings on flat ground. When a
 * terrain/site feature is added to the product, this becomes an input.
 */
export const KZT_TOPOGRAPHIC = 1.0

/**
 * Gust-effect factor G. ASCE 7-16 §26.11.1 permits G = 0.85 for rigid
 * buildings (fundamental frequency >= 1 Hz).
 *
 * ASSUMPTION: all structures modelled here are treated as rigid. This is
 * wrong for slender towers above roughly 10-15 storeys, where a flexible-
 * building gust factor Gf would exceed 0.85 (typically 0.9-1.2). The engine
 * emits a warning past the calibration range rather than silently
 * under-predicting.
 */
export const G_GUST_EFFECT = 0.85

/** Above this storey count the rigid-building assumption (G = 0.85) is shaky. */
export const RIGID_BUILDING_STOREY_LIMIT = 15

/**
 * Windward wall external pressure coefficient. ASCE 7-16 Fig. 27.3-1,
 * Cp = +0.8 for all L/B.
 */
export const CP_WINDWARD = 0.8

/**
 * Leeward wall external pressure coefficient, ASCE 7-16 Fig. 27.3-1, keyed on
 * L/B where L is the along-wind depth and B the across-wind width. Values are
 * negative (suction); we store magnitudes and add them to the windward Cp to
 * get the net force coefficient Cf.
 *
 *   L/B  0 to 1  ->  0.5
 *   L/B  2       ->  0.3
 *   L/B  >= 4    ->  0.2
 * Linear interpolation between, per the figure's note.
 */
export const CP_LEEWARD_TABLE: ReadonlyArray<readonly [ratio: number, cp: number]> = [
  [1.0, 0.5],
  [2.0, 0.3],
  [4.0, 0.2],
]

/**
 * Velocity pressure exposure coefficient Kz. ASCE 7-16 Table 26.10-1, Case 2,
 * converted from feet to metres.
 *
 * The table is the normative artefact, but it is a discretisation of the
 * power law
 *   Kz = 2.01 * (z / zg)^(2/alpha)
 * with (alpha, zg) = (7.0, 365.76 m) for B, (9.5, 274.32 m) for C and
 * (11.5, 213.36 m) for D, and z floored at 4.6 m (15 ft). `wind.test.ts`
 * checks the table against that power law so a mistyped entry cannot survive.
 *
 * Heights are the standard 15/20/25/30/40/.../500 ft rows in metres.
 */
export const KZ_HEIGHTS_M: readonly number[] = [
  4.6, 6.1, 7.6, 9.1, 12.2, 15.2, 18.0, 21.3, 24.4, 27.4, 30.5, 36.6, 42.7,
  48.8, 54.9, 61.0, 76.2, 91.4, 106.7, 121.9, 137.2, 152.4,
]

export const KZ_TABLE: Readonly<Record<'B' | 'C' | 'D', readonly number[]>> = {
  B: [
    0.57, 0.62, 0.66, 0.7, 0.76, 0.81, 0.85, 0.89, 0.93, 0.96, 0.99, 1.04,
    1.09, 1.13, 1.17, 1.2, 1.28, 1.35, 1.41, 1.47, 1.52, 1.56,
  ],
  C: [
    0.85, 0.9, 0.94, 0.98, 1.04, 1.09, 1.13, 1.17, 1.21, 1.24, 1.26, 1.31,
    1.36, 1.39, 1.43, 1.46, 1.53, 1.59, 1.64, 1.69, 1.73, 1.77,
  ],
  D: [
    1.03, 1.08, 1.12, 1.16, 1.22, 1.27, 1.31, 1.34, 1.38, 1.4, 1.43, 1.48,
    1.52, 1.55, 1.58, 1.61, 1.68, 1.73, 1.78, 1.82, 1.86, 1.89,
  ],
}

/** Power-law parameters behind KZ_TABLE. ASCE 7-16 Table 26.11-1. */
export const KZ_POWER_LAW: Readonly<
  Record<'B' | 'C' | 'D', { alpha: number; zg_m: number }>
> = {
  B: { alpha: 7.0, zg_m: 365.76 },
  C: { alpha: 9.5, zg_m: 274.32 },
  D: { alpha: 11.5, zg_m: 213.36 },
}

/** ASCE 7-16 Table 26.10-1 does not evaluate Kz below 15 ft (4.6 m). */
export const KZ_MIN_HEIGHT_M = 4.6

/**
 * Nominal aerodynamic roughness length z0 (metres) per exposure category,
 * ASCE 7-16 Commentary Table C26.7-1. Used only to sanity-check the
 * `terrainRoughness` supplied on the hazard against the declared exposure.
 */
export const EXPOSURE_ROUGHNESS_M: Readonly<Record<'B' | 'C' | 'D', number>> = {
  B: 0.3,
  C: 0.02,
  D: 0.005,
}

// ---------------------------------------------------------------------------
// Stability
// ---------------------------------------------------------------------------

/** Standard gravity, CODATA / ISO 80000-3. */
export const GRAVITY_M_S2 = 9.80665

/**
 * Target factor of safety against overturning and sliding.
 *
 * IBC §1605.1 / ASCE 7-16 §2.4 basic ASD combination 0.6D + 0.6W: only 60% of
 * dead load may be counted as resisting when wind uplift governs, which is
 * equivalent to demanding FoS >= 1/0.6 = 1.67 on the raw dead-load ratio. We
 * report the raw ratio and compare it against the conventional 1.5 used in
 * geotechnical practice for stability checks, which is the more forgiving and
 * more widely taught of the two.
 */
export const TARGET_SAFETY_FACTOR = 1.5

/**
 * Coefficient of friction between a concrete foundation and granular soil.
 * NAVFAC DM-7.2 and common foundation-design practice give tan(delta) with
 * delta ~ 2/3 * phi; for phi = 32deg this is ~0.38. We use 0.4.
 */
export const FOUNDATION_FRICTION_COEFFICIENT = 0.4

/**
 * Rankine passive earth pressure coefficient Kp = tan^2(45 + phi/2). For a
 * medium-dense granular backfill with phi = 30deg, Kp = 3.0.
 */
export const PASSIVE_PRESSURE_COEFFICIENT = 3.0

/** Unit weight of the retained/backfill soil, typical medium-dense sand. */
export const SOIL_UNIT_WEIGHT_KN_M3 = 18.0

/**
 * Fraction of theoretical Rankine passive resistance actually mobilised.
 *
 * ASSUMPTION: full passive pressure requires wall movement of roughly 2-5% of
 * the embedment depth, far more than a serviceable building tolerates. Halving
 * it is standard conservative practice.
 */
export const PASSIVE_MOBILISATION_FACTOR = 0.5

// ---------------------------------------------------------------------------
// Drift
// ---------------------------------------------------------------------------

/** Storey drift limit required by the brief: h/500. */
export const DRIFT_LIMIT_RATIO = 1 / 500

/**
 * Lateral system stiffness coefficients C_sys for the storey stiffness model
 *
 *   k_storey = C_sys * E * A_plan / h        [N/m, with E in Pa, A in m^2]
 *   drift    = V_storey / k_storey
 *
 * THESE ARE EMPIRICAL CALIBRATION CONSTANTS, NOT DERIVED QUANTITIES. A real
 * drift calculation needs the actual member layout (I of each column, brace
 * areas, wall lengths), which this model deliberately does not have. C_sys is
 * chosen so that a reference building lands on published typical drift ratios:
 *
 *   Reference: 10 storeys, 3.5 m each, 20 x 20 m plan (A = 400 m^2),
 *   base storey shear ~750 kN (the ~150 km/h, Exposure C design case).
 *
 *   steel moment frame  (E = 200 GPa) -> h/400   (drift-governed, as built)
 *   steel braced frame  (E = 200 GPa) -> h/800
 *   RC shear wall       (E = 25.7 GPa)-> h/1000
 *   no lateral system                 -> collapses; ratio ~1/4
 *
 * Two consequences to be honest about:
 *
 *  1. C_sys does not vary with material, so a concrete moment frame comes out
 *     ~8x more flexible than a steel one purely on the E ratio, whereas in
 *     practice member sizing narrows that gap a lot.
 *
 *  2. Stiffness scales linearly with plan area (k ~ A = B*L), but a real
 *     lateral system's flexural stiffness goes as I ~ B*L^3. Narrow plans are
 *     therefore under-penalised in the shear term and the model's drift for a
 *     slender tower far from the 20x20 m reference plan should be read as
 *     "very large" rather than as a specific number. A 12-storey tower on a
 *     6 m footprint reports ~14% drift here; the honest reading is that it has
 *     already failed, which its overturning FoS of 0.28 independently confirms.
 *
 * The model preserves the correct *direction* of every tradeoff (stiffer
 * material, stiffer system and wider plan all reduce drift) but its absolute
 * drift values are indicative. This is the single biggest tuning knob in the
 * engine; revisit it before any claim of quantitative accuracy. The natural
 * upgrade is a cantilever model with I = fraction * B*L^3/12, which fixes (2)
 * and makes the plan-shape lesson quantitative.
 */
export const LATERAL_STIFFNESS_COEFFICIENT: Readonly<
  Record<LateralSystem, number>
> = {
  'shear-wall': 7.5e-5,
  'braced-frame': 7.5e-6,
  'moment-frame': 3.75e-6,
  none: 3.0e-7,
}

// ---------------------------------------------------------------------------
// Material quantity take-off
// ---------------------------------------------------------------------------

/**
 * Structural volume fraction: the share of a storey's gross enclosed volume
 * (h * widthX * widthY) that is actually structural material.
 *
 *   volume_m3 = h * widthX * widthY * STRUCTURAL_FRACTION[class][system]
 *
 * Basis: typical structural quantities for mid-rise buildings. A steel frame
 * at roughly 50-90 kg/m^2 of floor area over a 3.5 m storey works out near
 * 1% of gross volume; an RC frame with 250 mm slabs plus columns and walls
 * lands in the 5-8% band; mass timber, being bulkier per unit strength, sits
 * near 12-15%; loadbearing masonry and rammed earth are thick-walled and
 * higher still.
 *
 * These are order-of-magnitude planning figures, good enough to make the
 * carbon/cost tradeoff behave correctly (steel: tiny volume, huge carbon
 * intensity; earth: huge volume, tiny carbon intensity), and they are the
 * right place to plug in real quantity take-offs later.
 *
 * Combinations that are not buildable in practice (a rammed-earth moment
 * frame) still return a number, but `analyze()` warns about them.
 */
export const STRUCTURAL_FRACTION: Readonly<
  Record<StructuralClass, Readonly<Record<LateralSystem, number>>>
> = {
  concrete: {
    'shear-wall': 0.08,
    'braced-frame': 0.06,
    'moment-frame': 0.055,
    none: 0.04,
  },
  steel: {
    'shear-wall': 0.014,
    'braced-frame': 0.01,
    'moment-frame': 0.012,
    none: 0.008,
  },
  aluminium: {
    'shear-wall': 0.024,
    'braced-frame': 0.018,
    'moment-frame': 0.022,
    none: 0.014,
  },
  timber: {
    'shear-wall': 0.15,
    'braced-frame': 0.12,
    'moment-frame': 0.13,
    none: 0.1,
  },
  bamboo: {
    'shear-wall': 0.14,
    'braced-frame': 0.11,
    'moment-frame': 0.12,
    none: 0.09,
  },
  masonry: {
    'shear-wall': 0.18,
    'braced-frame': 0.17,
    'moment-frame': 0.18,
    none: 0.15,
  },
  earth: {
    'shear-wall': 0.25,
    'braced-frame': 0.25,
    'moment-frame': 0.25,
    none: 0.22,
  },
}

/**
 * Systems each structural class can actually be built as. Anything outside
 * this set produces a warning (not an error — students learn by trying the
 * absurd thing and reading why it is absurd).
 */
export const BUILDABLE_SYSTEMS: Readonly<
  Record<StructuralClass, ReadonlySet<LateralSystem>>
> = {
  concrete: new Set<LateralSystem>(['shear-wall', 'moment-frame', 'braced-frame', 'none']),
  steel: new Set<LateralSystem>(['moment-frame', 'braced-frame', 'shear-wall', 'none']),
  aluminium: new Set<LateralSystem>(['moment-frame', 'braced-frame', 'none']),
  timber: new Set<LateralSystem>(['shear-wall', 'braced-frame', 'moment-frame', 'none']),
  bamboo: new Set<LateralSystem>(['shear-wall', 'braced-frame', 'none']),
  masonry: new Set<LateralSystem>(['shear-wall', 'none']),
  earth: new Set<LateralSystem>(['shear-wall', 'none']),
}
