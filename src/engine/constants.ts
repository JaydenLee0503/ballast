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
  Hazard,
  LateralSystem,
  PlanShape,
  SiteClass,
  StructuralClass,
  Typology,
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

export const TYPOLOGIES = exhaustiveList<Typology>()([
  'custom',
  'house',
  'townhouse',
  'apartment-block',
  'office-tower',
  'warehouse',
  'school',
])

export const PLAN_SHAPES = exhaustiveList<PlanShape>()(['rectangle', 'ellipse'])

export const FACADE_SYSTEMS = exhaustiveList<FacadeSystem>()([
  'exposed',
  'punched',
  'ribbon',
  'curtain-wall',
])

export const SITE_CLASSES = exhaustiveList<SiteClass>()(['A', 'B', 'C', 'D', 'E'])

/** The hazards `analyze()` can dispatch on, at runtime. */
export const HAZARD_KINDS = exhaustiveList<Hazard['kind']>()([
  'wind',
  'seismic',
  'flood',
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
 * Force coefficient Cf for a building of round cross-section, keyed on the
 * whole-building slenderness h/D.
 *
 * ASCE 7-16 Table 29.4-1 ("Other Structures"), round cross-section, moderately
 * smooth surface, in the high-Reynolds branch D*sqrt(qz) > 5.3 (SI; the table
 * states 2.5 in imperial units) — which every building at these sizes and wind
 * speeds is in:
 *
 *   h/D  1   ->  0.5
 *   h/D  7   ->  0.6
 *   h/D  25  ->  0.7
 *
 * Linear interpolation between, clamped outside, the same treatment the Kz
 * table gets.
 *
 * WHY THIS IS THE LESSON. The rectangular path in `wind.ts` builds Cf out of
 * the windward and leeward pressure coefficients and lands on 1.3 for a squat
 * square plan, which is the value Table 29.4-1 gives for a square section too —
 * so the two families are consistent, and a round building of the same size
 * genuinely catches roughly half the along-wind force. That is not a modelling
 * convenience; it is why chimneys and towers are round.
 *
 * NOT MODELLED, and it is the honest edge of this: across-wind vortex shedding,
 * which is what actually governs a slender round tower. The engine has no
 * across-wind case at all (see the `wind.ts` header), so a round plan here only
 * ever helps. `analyze()` warns on a slender ellipse for that reason.
 */
export const CF_ROUND_TABLE: ReadonlyArray<readonly [slenderness: number, cf: number]> = [
  [1, 0.5],
  [7, 0.6],
  [25, 0.7],
]

/**
 * Above this height-to-diameter ratio a round plan is in the regime where
 * across-wind vortex shedding, which this engine does not model, would normally
 * govern. Chosen as the point where ASCE 7-16 C26.11 and the general literature
 * put crosswind response on a par with along-wind for circular sections; it is
 * a warning threshold, not a coefficient, and nothing computes with it.
 */
export const ROUND_CROSSWIND_SLENDERNESS_LIMIT = 5

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

// ---------------------------------------------------------------------------
// Seismic: ASCE 7-16 Equivalent Lateral Force procedure (Ch. 11-12)
// ---------------------------------------------------------------------------

/**
 * Scope of the seismic model, stated once here so the rest can be terse.
 *
 *   - Equivalent Lateral Force procedure (ASCE 7-16 §12.8) only. No modal
 *     response spectrum analysis, no time history, no soil-structure
 *     interaction.
 *   - One horizontal direction at a time, at the bearing the student picks.
 *     A real earthquake shakes in every direction at once and ASCE 7 §12.5
 *     requires orthogonal combinations for some systems; this engine evaluates
 *     the single direction, which is the same simplification the wind side
 *     makes and for the same reason.
 *   - No vertical ground motion (§12.4.2.2), no accidental torsion
 *     (§12.8.4.2), no redundancy factor rho, no irregularity checks.
 *   - Effective seismic weight W is the structural frame plus the facade,
 *     because that is the whole of the dead load this engine knows. ASCE 7-16
 *     §12.7.2 would also include partitions, permanent equipment and, in a
 *     warehouse, 25% of the storage live load. W here is therefore low, which
 *     makes the base shear low: this is the one place the seismic branch is
 *     unconservative, and `analyze()` says so in a warning.
 */

/**
 * Site coefficient Fa, ASCE 7-16 Table 11.4-1, keyed on site class and the
 * mapped short-period acceleration Ss. Interpolated linearly between the
 * tabulated Ss values, per the note on the table, and clamped outside them.
 *
 * The pattern is the lesson: on hard rock (A, B) the coefficient is below 1
 * and soft soil (D, E) amplifies — dramatically at low Ss, where E nearly
 * triples the motion. That is why the same earthquake flattens one
 * neighbourhood and leaves the next one standing.
 *
 * ASCE 7-16 marks Site Class E as requiring a site-specific ground motion
 * analysis above Ss = 0.75 (note a on the table). This engine clamps to the
 * last tabulated value there and `analyze()` warns, rather than refusing to
 * produce a result a student is looking at a slider for.
 */
export const FA_SS_POINTS: readonly number[] = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5]

export const FA_TABLE: Readonly<Record<SiteClass, readonly number[]>> = {
  A: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
  B: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9],
  C: [1.3, 1.3, 1.2, 1.2, 1.2, 1.2],
  D: [1.6, 1.4, 1.2, 1.1, 1.0, 1.0],
  // Values above Ss = 0.75 are note (a) in the standard: site-specific study
  // required. Held flat at the last tabulated number, with a warning.
  E: [2.4, 1.7, 1.3, 1.3, 1.3, 1.3],
}

/**
 * Site coefficient Fv, ASCE 7-16 Table 11.4-2, keyed on site class and the
 * mapped one-second acceleration S1. Same treatment as Fa above.
 *
 * ASCE 7-16 note (b) requires a site-specific analysis for Site Class D and E
 * at S1 >= 0.2; the tabulated values are kept here and `analyze()` warns.
 */
export const FV_S1_POINTS: readonly number[] = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]

export const FV_TABLE: Readonly<Record<SiteClass, readonly number[]>> = {
  A: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
  B: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
  C: [1.5, 1.5, 1.5, 1.5, 1.5, 1.4],
  D: [2.4, 2.2, 2.0, 1.9, 1.8, 1.7],
  E: [4.2, 3.3, 2.8, 2.4, 2.2, 2.0],
}

/** Above this S1, Site Classes D and E need a site-specific study (note b). */
export const SITE_SPECIFIC_S1_THRESHOLD_G = 0.2
/** Above this Ss, Site Class E needs a site-specific study (note a). */
export const SITE_SPECIFIC_E_SS_THRESHOLD_G = 0.75

/** Design accelerations are two thirds of the MCE_R values. §11.4.4. */
export const DESIGN_ACCELERATION_FRACTION = 2 / 3

/**
 * Seismic design coefficients per lateral system: the response modification
 * factor R and the deflection amplification factor Cd, ASCE 7-16 Table 12.2-1.
 *
 * R is the ductility discount: a system that can yield repeatedly without
 * losing its footing is designed for a fraction of the elastic force, because
 * it is expected to absorb the rest by deforming. That is why a moment frame
 * (R = 8) is designed for a quarter of the force a shear wall building
 * (R = 5) is — and why the moment frame then has to be checked for drift it
 * will actually experience, which is what Cd puts back.
 *
 *   shear-wall    Special reinforced concrete shear wall, bearing wall system
 *                 (Table 12.2-1 A.1): R = 5, Cd = 5.
 *   braced-frame  Steel special concentrically braced frame, building frame
 *                 system (B.2): R = 6, Cd = 5.
 *   moment-frame  Steel special moment frame (C.1): R = 8, Cd = 5.5.
 *
 * `none` is OFF THE TABLE, and deliberately so: ASCE 7 has no entry for a
 * building with no lateral force resisting system, because such a building may
 * not be built in any seismic design category. R = 1.25 is the lowest value the
 * standard assigns anywhere (Table 15.4-2, for nonbuilding structures not
 * similar to buildings), used here so that "no system" produces a force close
 * to the unreduced elastic one rather than a number implying ductility that
 * does not exist. It is a calibration choice, not a code value.
 */
export interface SeismicSystemFactors {
  /** Response modification coefficient, dimensionless. */
  readonly R: number
  /** Deflection amplification factor, dimensionless. */
  readonly Cd: number
}

export const SEISMIC_SYSTEM_FACTORS: Readonly<
  Record<LateralSystem, SeismicSystemFactors>
> = {
  'shear-wall': { R: 5, Cd: 5 },
  'braced-frame': { R: 6, Cd: 5 },
  'moment-frame': { R: 8, Cd: 5.5 },
  none: { R: 1.25, Cd: 1.25 },
}

/**
 * Importance factor Ie. ASCE 7-16 Table 1.5-2, Risk Category II — ordinary
 * buildings, which is everything this app lets a student describe.
 *
 * ASSUMPTION: a hospital or a fire station is Risk Category IV with Ie = 1.5,
 * a 50% increase in design force. `Structure.typology` would be the natural
 * hook for that, and it deliberately is not wired to one — see the note on
 * `Typology`: a typology must never silently become a coefficient.
 */
export const IMPORTANCE_FACTOR_IE = 1.0

/**
 * Approximate fundamental period parameters, ASCE 7-16 Table 12.8-2, in SI:
 *   Ta = Ct * h^x        [s, h in metres]
 *
 *   Steel moment-resisting frames          Ct = 0.0724, x = 0.8
 *   Concrete moment-resisting frames       Ct = 0.0466, x = 0.9
 *   All other structural systems           Ct = 0.0488, x = 0.75
 *
 * The period matters because it decides which branch of the design spectrum
 * the building sits on: short and stiff means the flat SDS plateau, tall and
 * flexible means the descending SD1/T branch and a lower design force. It is
 * the reason a tall building is not simply a short building scaled up.
 */
export interface PeriodParameters {
  readonly Ct: number
  readonly x: number
}

export const PERIOD_STEEL_MOMENT_FRAME: PeriodParameters = { Ct: 0.0724, x: 0.8 }
export const PERIOD_CONCRETE_MOMENT_FRAME: PeriodParameters = { Ct: 0.0466, x: 0.9 }
export const PERIOD_OTHER: PeriodParameters = { Ct: 0.0488, x: 0.75 }

/**
 * Long-period transition period TL, ASCE 7-16 Fig. 22-14. Ranges from 4 s to
 * 16 s across the United States; 8 s covers most of it.
 *
 * ASSUMPTION: fixed, because it is a map value and there is no site here.
 * Nothing a student can build gets near it — TL only governs above T = 8 s,
 * which is a 100-storey building — so this is a completeness term rather than
 * a live one.
 */
export const LONG_PERIOD_TRANSITION_S = 8

/**
 * Seismic response coefficient floors, ASCE 7-16 Eqs. 12.8-5 and 12.8-6:
 *   Cs >= 0.044 * SDS * Ie,  and never less than 0.01
 *   Cs >= 0.5 * S1 / (R/Ie)  where S1 >= 0.6 g
 * The floors are what stop a very flexible building being designed for nothing.
 */
export const CS_MINIMUM_SDS_FACTOR = 0.044
export const CS_ABSOLUTE_MINIMUM = 0.01
export const CS_HIGH_S1_THRESHOLD_G = 0.6
export const CS_HIGH_S1_FACTOR = 0.5

/**
 * Vertical distribution exponent k, ASCE 7-16 §12.8.3:
 *   k = 1 for T <= 0.5 s, k = 2 for T >= 2.5 s, linear between.
 * k = 1 spreads the force in proportion to weight x height — an inverted
 * triangle. k = 2 pushes more of it to the top, which is what a long-period
 * building actually does.
 */
export const K_EXPONENT_LOW_PERIOD_S = 0.5
export const K_EXPONENT_HIGH_PERIOD_S = 2.5

/**
 * Allowable storey drift under the design earthquake, ASCE 7-16 Table 12.12-1,
 * "all other structures", Risk Category I or II: 0.020 * h.
 *
 * Ten times looser than the wind limit in this file, and that is not an
 * inconsistency: the wind check is serviceability — a building that sways
 * enough to crack plaster and frighten occupants every winter — while the
 * seismic check is life safety under an event expected once in a building's
 * life, where yielding is the design intent rather than a failure.
 */
export const SEISMIC_DRIFT_LIMIT_RATIO = 0.02

/**
 * Above this storey count, the equal-displacement assumption behind Cd and the
 * single-mode ELF procedure both get shaky: ASCE 7-16 Table 12.6-1 requires a
 * modal analysis for many structures over about 48 m, which at a 3.5 m storey
 * is roughly here.
 */
export const ELF_STOREY_LIMIT = 14

// ---------------------------------------------------------------------------
// Flood: ASCE 7-16 Ch. 5, with the commentary's hydrodynamic treatment
// ---------------------------------------------------------------------------

/**
 * Scope of the flood model.
 *
 *   - Hydrostatic lateral pressure on the submerged part of the windward face,
 *     with a dry interior. A building that is allowed to flood inside (wet
 *     floodproofing, ASCE 24 §2.6) equalises and sees almost none of this; a
 *     dry-floodproofed one sees all of it. The dry case is modelled because it
 *     is the one that fails.
 *   - Hydrodynamic drag from the flow, per ASCE 7-16 Eq. C5.4-3.
 *   - Buoyancy on the displaced volume, which is what actually lifts light
 *     buildings off their foundations.
 *   - NOT MODELLED: breaking wave loads (§5.4.4, which dominate in a coastal
 *     V zone and can be several times the hydrostatic force), debris impact
 *     (§5.4.5), scour and erosion of the soil under the footing, buoyancy of
 *     saturated soil reducing friction, and any of it acting together with
 *     wind. `analyze()` warns about all of these.
 */

/**
 * Unit weight of fresh water at 4 degC. ASCE 7-16 §5.4.2 uses 62.4 lb/ft^3
 * (9.81 kN/m^3) for fresh water and 64.0 (10.05) for salt water.
 *
 * ASSUMPTION: fresh. A coastal flood is about 2.5% heavier, which is inside
 * the noise of everything else here.
 */
export const WATER_UNIT_WEIGHT_KN_M3 = 9.81

/**
 * Drag coefficient Cd for hydrodynamic load, ASCE 7-16 Table C5.4-1, keyed on
 * the ratio of the obstructed width to the stillwater depth. A wide, shallow
 * obstruction behaves more like a dam and less like a pier, so Cd rises.
 *
 * Stored as (width/depth, Cd) points and interpolated, where the standard
 * tabulates bands; the interpolation is this engine's choice and is monotonic
 * in the same direction as the bands.
 */
export const FLOOD_DRAG_COEFFICIENT_TABLE: ReadonlyArray<
  readonly [widthOverDepth: number, cd: number]
> = [
  [12, 1.25],
  [20, 1.3],
  [32, 1.4],
  [40, 1.5],
  [65, 1.75],
  [90, 1.8],
  [91, 2.0],
]

/**
 * Above this flow velocity the flood is better modelled as a hydraulic event
 * with wave and debris loading than as the quasi-static case here. ASCE 7-16
 * C5.4.3 notes that velocities above roughly 3 m/s in a riverine flood are
 * usually accompanied by debris; it is a warning threshold, not a coefficient.
 */
export const HIGH_FLOW_VELOCITY_MS = 3

/**
 * Fraction of the gross enclosed volume that displaces water when submerged.
 *
 * CALIBRATION, not a code value. A real building floods through vents, doors,
 * cracks and service penetrations long before it is fully submerged, and ASCE
 * 24 requires openings in enclosures below the design flood elevation for
 * exactly this reason. Taking the whole gross volume as displaced would model
 * a sealed hull, which no building is; taking none would model a sieve, which
 * a dry-floodproofed building also is not. 0.85 is the sealed-but-leaky middle,
 * chosen so that a light timber building at three metres of water floats (which
 * is the observed behaviour) and a heavy concrete one does not.
 *
 * It is the single biggest knob in the flood branch, in the same sense
 * LATERAL_STIFFNESS_COEFFICIENT is for drift. Revisit it before quoting a
 * flotation safety factor as anything but a teaching number.
 */
export const BUOYANT_VOLUME_FRACTION = 0.85

// ---------------------------------------------------------------------------
// Damage banding
// ---------------------------------------------------------------------------

/**
 * Where one `DamageState` becomes the next, on the same dimensionless
 * demand/capacity ratio that colours a storey.
 *
 * These are a BANDING OF A FIGURE THE ENGINE ALREADY PRODUCED, in the way
 * `lib/palette.ts` bands the same number into three colours. They add no
 * physics and they are not a damage model: a real one needs a fragility curve
 * per component and a nonlinear analysis to drive it, and this engine is
 * linear-elastic.
 *
 *   1.0  the limit itself. At or below it, nothing to draw.
 *   1.5  half again past the limit. In a real design this is where the
 *        elastic model's reserve — the conservatism in the section modulus,
 *        the material factors — is plausibly used up.
 *   2.5  more than double. Past here a linear-elastic result is not a
 *        prediction of anything, and 'collapsed' is the honest label precisely
 *        because no number would be.
 *
 * Deliberately coarse. Three bands, like the colours, so that the picture and
 * the table cannot say different things.
 */
export const DAMAGE_THRESHOLDS = {
  cracked: 1.0,
  severe: 1.5,
  collapsed: 2.5,
} as const
