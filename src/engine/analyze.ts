/**
 * The engine entry point.
 *
 * `analyze(structure, hazard, library)` is the ONLY function the rest of the
 * app should need. It is pure: same inputs, same numbers, every time. Nothing
 * in this file consults a network, a clock, a random source, or a language
 * model — every value in the returned ScoreCard is traceable to a formula in
 * wind.ts / seismic.ts / flood.ts / drift.ts / stability.ts /
 * sustainability.ts and a constant with a citation.
 *
 * THREE HAZARDS, ONE PIPELINE. What a wind, an earthquake and a flood have in
 * common is the shape of the answer: a lateral force per storey, accumulated
 * downward into shears and a base moment, then checked against overturning,
 * sliding, drift and storey bending. What differs is where the load comes from
 * and where it lands — wind pushes on the top, an earthquake shakes the mass,
 * a flood leans on the bottom and tries to float the whole thing. So each
 * hazard owns one function that produces per-storey forces and its own
 * warnings, and everything after that is shared. A fourth hazard is a fourth
 * such function plus a `case`.
 *
 * The ORDER matters and is not arbitrary. Quantities and weights are computed
 * *before* the hazard branch, because seismic force is proportional to weight
 * and flood buoyancy is subtracted from it. Wind does not care, but a pipeline
 * that computed loads first would have to be turned inside out the moment a
 * mass-proportional hazard arrived — which is what this one already is.
 */

import type {
  AnalysisResult,
  FailureMode,
  FloodHazard,
  Hazard,
  MaterialEntry,
  MaterialLibrary,
  ScoreCard,
  SeismicHazard,
  StabilityResult,
  Storey,
  StoreyResult,
  Structure,
  WindHazard,
} from './types.ts'
import {
  BUILDABLE_SYSTEMS,
  DRIFT_LIMIT_RATIO,
  ELF_STOREY_LIMIT,
  FACADE,
  HIGH_FLOW_VELOCITY_MS,
  KZ_HEIGHTS_M,
  RIGID_BUILDING_STOREY_LIMIT,
  ROUND_CROSSWIND_SLENDERNESS_LIMIT,
  SEISMIC_DRIFT_LIMIT_RATIO,
  SITE_SPECIFIC_E_SS_THRESHOLD_G,
  SITE_SPECIFIC_S1_THRESHOLD_G,
  STRUCTURAL_FRACTION,
  TARGET_SAFETY_FACTOR,
} from './constants.ts'
import { getMaterial } from './materials.ts'
import {
  checkRoughnessConsistency,
  storeyGeometry,
  storeyWindLoad,
  type StoreyGeometry,
} from './wind.ts'
import { seismicDesign } from './seismic.ts'
import { obstructedWidth_m, flotationSafetyFactor, storeyFloodLoad } from './flood.ts'
import { projectPlan } from './plan.ts'
import { storeyDrift } from './drift.ts'
import { facadeQuantities, storeyQuantities } from './sustainability.ts'
import { assessDamage } from './damage.ts'
import {
  effectiveSectionModulus_m3,
  frictionResistance_kN,
  overturningMoment_kNm,
  passiveResistance_kN,
  restoringMomentAnchorage_kNm,
  restoringMomentSelfWeight_kNm,
  safetyFactor,
  strengthUtilization,
  sumSelfWeight_kN,
} from './stability.ts'

export class StructureValidationError extends Error {
  override readonly name = 'StructureValidationError'
}

function requireNonNegative(value: number, path: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new StructureValidationError(`${path} must be >= 0, got ${String(value)}`)
  }
}

function validate(structure: Structure, hazard: Hazard): void {
  if (structure.storeys.length === 0) {
    throw new StructureValidationError('structure has no storeys')
  }
  structure.storeys.forEach((storey, i) => {
    const dims = {
      height_m: storey.height_m,
      widthX_m: storey.widthX_m,
      widthY_m: storey.widthY_m,
    }
    for (const [name, value] of Object.entries(dims)) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new StructureValidationError(
          `storey ${i}: ${name} must be a positive finite number, got ${String(value)}`,
        )
      }
    }
  })
  requireNonNegative(
    structure.foundation.embedmentDepth_m,
    'foundation.embedmentDepth_m',
  )
  requireNonNegative(
    structure.foundation.anchorCapacity_kN,
    'foundation.anchorCapacity_kN',
  )

  switch (hazard.kind) {
    case 'wind':
      requireNonNegative(hazard.gustSpeed_kmh, 'hazard.gustSpeed_kmh')
      return
    case 'seismic':
      requireNonNegative(hazard.Ss_g, 'hazard.Ss_g')
      requireNonNegative(hazard.S1_g, 'hazard.S1_g')
      return
    case 'flood':
      requireNonNegative(hazard.depth_m, 'hazard.depth_m')
      requireNonNegative(hazard.velocity_ms, 'hazard.velocity_ms')
      return
    default: {
      const exhaustive: never = hazard
      throw new StructureValidationError(
        `unsupported hazard: ${JSON.stringify(exhaustive)}`,
      )
    }
  }
}

/**
 * Pick the governing failure mode.
 *
 * Every check is normalised to a demand/capacity ratio where 1.0 means "at the
 * limit", so they are directly comparable:
 *   overturning / sliding / flotation : TARGET_SAFETY_FACTOR / FoS
 *   drift                             : driftRatio / limit
 *   storey strength                   : bending stress / yield strength
 * The largest ratio governs. If nothing exceeds 1.0, the structure passes and
 * the mode is 'none' — but the ratios are still what the UI should show,
 * because "passes at 0.98" is a very different design from "passes at 0.2".
 */
function governingMode(
  ratios: ReadonlyArray<readonly [FailureMode, number]>,
): FailureMode {
  let worst: FailureMode = 'none'
  let worstRatio = 1
  for (const [mode, ratio] of ratios) {
    if (ratio > worstRatio) {
      worst = mode
      worstRatio = ratio
    }
  }
  return worst
}

/** What one hazard has to produce for the shared pipeline to take over. */
interface StoreyLoad {
  lateralForce_kN: number
  projectedArea_m2: number
  /** Where the force acts, above the foundation. */
  loadElevation_m: number
  Kz?: number
  velocityPressure_Pa?: number
  submergedDepth_m?: number
  buoyancy_kN?: number
}

interface HazardLoading {
  loads: StoreyLoad[]
  warnings: string[]
  /** ASCE 7-16 Cd, or 1 where the hazard has no such amplification. */
  driftAmplification: number
  driftLimitRatio: number
  /** Total uplift subtracted from the weight that resists overturning. */
  buoyancy_kN: number
}

/** Everything both the hazard branch and the assembly need. */
interface BuildingInputs {
  geometry: StoreyGeometry[]
  materials: MaterialEntry[]
  totalHeight_m: number
  /** Frame plus facade, per storey, bottom-to-top. */
  storeyWeights_kN: number[]
  quantities: ReturnType<typeof storeyQuantities>[]
  envelopes: ReturnType<typeof facadeQuantities>[]
}

function buildingInputs(
  structure: Structure,
  library: MaterialLibrary,
): BuildingInputs {
  const geometry = storeyGeometry(structure)
  const materials = structure.storeys.map((s) => getMaterial(library, s.materialId))
  const quantities = structure.storeys.map((storey, i) => {
    const material = materials[i]
    if (material === undefined) throw new Error('material index mismatch')
    return storeyQuantities(storey, material)
  })
  // Kept separate from the frame take-off all the way to the result, so the
  // per-storey split stays reportable rather than inferable.
  const envelopes = structure.storeys.map(facadeQuantities)

  return {
    geometry,
    materials,
    totalHeight_m: geometry[geometry.length - 1]?.topElevation_m ?? 0,
    quantities,
    envelopes,
    storeyWeights_kN: quantities.map(
      (qty, i) => qty.selfWeight_kN + (envelopes[i]?.selfWeight_kN ?? 0),
    ),
  }
}

// ---------------------------------------------------------------------------
// Wind
// ---------------------------------------------------------------------------

function windLoading(
  structure: Structure,
  hazard: WindHazard,
  inputs: BuildingInputs,
): HazardLoading {
  const warnings: string[] = []
  const { geometry, totalHeight_m } = inputs

  const roughnessWarning = checkRoughnessConsistency(
    structure.exposureCategory,
    hazard.terrainRoughness,
  )
  if (roughnessWarning !== null) warnings.push(roughnessWarning)

  if (structure.storeys.length > RIGID_BUILDING_STOREY_LIMIT) {
    warnings.push(
      `${structure.storeys.length} storeys exceeds the rigid-building ` +
        `assumption (G = 0.85) this engine relies on. A flexible-building ` +
        `gust factor would raise the loads; results under-predict.`,
    )
  }
  // A round plan lowers the along-wind force coefficient, and this engine has no
  // across-wind case at all — so an ellipse can only ever make a design look
  // safer. For a squat building that is fair; for a slender one, vortex
  // shedding is what actually governs and is entirely absent here, which is the
  // sort of thing a student has to be told before they quote the number.
  const narrowestRound = structure.storeys.reduce((worst, storey) => {
    if (storey.planShape !== 'ellipse') return worst
    return Math.min(worst, storey.widthX_m, storey.widthY_m)
  }, Number.POSITIVE_INFINITY)
  if (
    Number.isFinite(narrowestRound) &&
    totalHeight_m / narrowestRound > ROUND_CROSSWIND_SLENDERNESS_LIMIT
  ) {
    warnings.push(
      `A round plan this slender (height / diameter over ` +
        `${ROUND_CROSSWIND_SLENDERNESS_LIMIT}) is normally governed by ` +
        `across-wind vortex shedding, which this engine does not model at all. ` +
        `The round shape lowers the along-wind force coefficient here, so these ` +
        `results are optimistic rather than conservative.`,
    )
  }

  const kzTop = KZ_HEIGHTS_M[KZ_HEIGHTS_M.length - 1] ?? 0
  if (totalHeight_m > kzTop) {
    warnings.push(
      `Total height ${totalHeight_m.toFixed(1)} m is above the top of the ` +
        `ASCE 7 Kz table (${kzTop} m); Kz is clamped at its highest value.`,
    )
  }

  const loads = geometry.map((g) => {
    // The total height goes down with each storey because a round plan's force
    // coefficient is read off the *building's* slenderness, not the storey's.
    const load = storeyWindLoad(
      structure.exposureCategory,
      hazard,
      g,
      totalHeight_m,
    )
    return { ...load, loadElevation_m: g.midHeight_m }
  })

  return {
    loads,
    warnings,
    driftAmplification: 1,
    driftLimitRatio: DRIFT_LIMIT_RATIO,
    buoyancy_kN: 0,
  }
}

// ---------------------------------------------------------------------------
// Seismic
// ---------------------------------------------------------------------------

function seismicLoading(
  structure: Structure,
  hazard: SeismicHazard,
  inputs: BuildingInputs,
): HazardLoading {
  const warnings: string[] = []
  const { geometry, materials, totalHeight_m, storeyWeights_kN } = inputs

  const groundClass = materials[0]?.structuralClass ?? 'concrete'
  const design = seismicDesign(
    hazard,
    totalHeight_m,
    structure.storeys.map((s) => s.lateralSystem),
    groundClass,
    storeyWeights_kN,
    geometry.map((g) => g.midHeight_m),
  )

  // The one place the seismic branch is knowingly unconservative, so it is the
  // first thing said. See the scope note in constants.ts.
  warnings.push(
    'Seismic weight here is the structural frame plus the facade only. ASCE ' +
      '7-16 §12.7.2 would also count partitions, finishes, services and — in ' +
      'storage occupancies — part of the live load, so the real base shear ' +
      'would be higher than this.',
  )

  warnings.push(
    `Only one horizontal direction is analysed (${Math.round(hazard.directionDeg)}°). ` +
      'A real earthquake shakes in every direction at once, and this engine ' +
      'models no vertical motion, no accidental torsion and no soil-structure ' +
      'interaction.',
  )

  if (structure.storeys.length > ELF_STOREY_LIMIT) {
    warnings.push(
      `At ${structure.storeys.length} storeys the Equivalent Lateral Force ` +
        'procedure is outside where ASCE 7-16 Table 12.6-1 allows it on its ' +
        'own; higher modes matter and a modal response spectrum analysis ' +
        'would be required.',
    )
  }

  if (
    hazard.siteClass === 'E' &&
    hazard.Ss_g > SITE_SPECIFIC_E_SS_THRESHOLD_G
  ) {
    warnings.push(
      `Site Class E above Ss = ${SITE_SPECIFIC_E_SS_THRESHOLD_G} g is note (a) ` +
        'on ASCE 7-16 Table 11.4-1: a site-specific ground motion study is ' +
        'required and no tabulated Fa exists. The last tabulated value is used ' +
        'here, which understates the amplification soft soil produces.',
    )
  }
  if (
    (hazard.siteClass === 'D' || hazard.siteClass === 'E') &&
    hazard.S1_g >= SITE_SPECIFIC_S1_THRESHOLD_G
  ) {
    warnings.push(
      `Site Class ${hazard.siteClass} at S1 >= ${SITE_SPECIFIC_S1_THRESHOLD_G} g ` +
        'is note (b) on ASCE 7-16 Table 11.4-2, which also calls for a ' +
        'site-specific study. The tabulated Fv is used anyway.',
    )
  }

  const mixedSystems = new Set(structure.storeys.map((s) => s.lateralSystem))
  if (mixedSystems.size > 1) {
    warnings.push(
      `The building mixes lateral systems, so ASCE 7-16 §12.2.3.1 makes the ` +
        `weakest of them govern: the whole structure is designed with the ` +
        `'${design.governingSystem}' response modification factor R = ` +
        `${design.R}. One unbraced storey costs the whole tower its ductility ` +
        'credit.',
    )
  }
  if (design.governingSystem === 'none') {
    warnings.push(
      'A storey with no lateral system has no entry in ASCE 7-16 Table ' +
        '12.2-1 — such a building may not be built in any seismic design ' +
        'category. R = 1.25 is a calibration choice standing in for "no ' +
        'ductility at all", not a code value.',
    )
  }

  const loads: StoreyLoad[] = geometry.map((g, i) => {
    const projection = projectPlan(
      g.storey.widthX_m,
      g.storey.widthY_m,
      hazard.directionDeg,
      g.storey.planShape,
    )
    return {
      lateralForce_kN: design.storeyForces_kN[i] ?? 0,
      // Not a loaded face — an earthquake acts on mass, not on a surface — but
      // the elevation profile is what the viewport draws, and reporting the
      // face the shaking is measured across keeps the field meaning one thing.
      projectedArea_m2: projection.acrossWindWidth_m * g.storey.height_m,
      loadElevation_m: g.midHeight_m,
    }
  })

  return {
    loads,
    warnings,
    driftAmplification: design.Cd,
    driftLimitRatio: SEISMIC_DRIFT_LIMIT_RATIO,
    buoyancy_kN: 0,
  }
}

// ---------------------------------------------------------------------------
// Flood
// ---------------------------------------------------------------------------

function floodLoading(
  structure: Structure,
  hazard: FloodHazard,
  inputs: BuildingInputs,
): HazardLoading {
  const warnings: string[] = []
  const { geometry, totalHeight_m } = inputs

  const width_m = obstructedWidth_m(
    structure.storeys,
    geometry.map((g) => g.baseElevation_m),
    hazard,
  )
  const floodLoads = geometry.map((g) =>
    storeyFloodLoad(g.storey, g.baseElevation_m, hazard, width_m),
  )

  warnings.push(
    'The building is modelled as dry inside, so the full hydrostatic pressure ' +
      'acts on one face. A building designed to flood internally (wet ' +
      'floodproofing, ASCE 24 §2.6) equalises and sees almost none of it — ' +
      'which is why flood-zone buildings have vents rather than thicker walls.',
  )
  warnings.push(
    'No breaking wave load, no debris impact, no scour of the soil under the ' +
      'footing, and no wind acting at the same time. In a coastal surge the ' +
      'wave term alone can be several times the hydrostatic force modelled ' +
      'here, so this result is a riverine flood, not a storm surge.',
  )

  if (hazard.velocity_ms > HIGH_FLOW_VELOCITY_MS) {
    warnings.push(
      `A flow above ${HIGH_FLOW_VELOCITY_MS} m/s almost always carries debris, ` +
        'and a single floating car or log is an impact load this engine does ' +
        'not model at all.',
    )
  }
  if (hazard.depth_m > totalHeight_m && hazard.depth_m > 0) {
    warnings.push(
      `The water (${hazard.depth_m.toFixed(1)} m) is deeper than the building ` +
        `is tall (${totalHeight_m.toFixed(1)} m). It is fully submerged, and ` +
        'nothing above roof level adds any more load.',
    )
  }

  const buoyancy_kN = floodLoads.reduce((sum, load) => sum + load.buoyancy_kN, 0)

  return {
    loads: floodLoads.map((load, i) => ({
      lateralForce_kN: load.lateralForce_kN,
      projectedArea_m2: load.projectedArea_m2,
      loadElevation_m: load.loadElevation_m ?? geometry[i]?.midHeight_m ?? 0,
      submergedDepth_m: load.submergedDepth_m,
      buoyancy_kN: load.buoyancy_kN,
    })),
    warnings,
    driftAmplification: 1,
    driftLimitRatio: DRIFT_LIMIT_RATIO,
    buoyancy_kN,
  }
}

// ---------------------------------------------------------------------------
// The shared pipeline
// ---------------------------------------------------------------------------

/** Warnings about the design itself, true whichever hazard is applied. */
function designWarnings(
  structure: Structure,
  materials: readonly MaterialEntry[],
): string[] {
  const warnings: string[] = []

  materials.forEach((material, i) => {
    const storey = structure.storeys[i]
    if (storey === undefined) return
    if (!BUILDABLE_SYSTEMS[material.structuralClass].has(storey.lateralSystem)) {
      warnings.push(
        `Storey ${i + 1}: a '${storey.lateralSystem}' in ${material.name} is ` +
          `not a buildable system. The numbers below are computed anyway, but ` +
          `they describe something nobody can construct.`,
      )
    }
  })

  if (materials.some((m) => m.costConfidence === 'indicative')) {
    warnings.push(
      'Cost uses indicative per-m^3 rates, not a quantity-surveyed estimate. ' +
        'Treat cost comparisons as order-of-magnitude only.',
    )
  }

  if (structure.storeys.some((storey) => storey.facade !== 'exposed')) {
    warnings.push(
      'Facade carbon, cost and weight use assembly-level archetype rates, ' +
        'not a specific product or EPD. A 3x difference between two facades ' +
        'is real; a 10% difference is noise.',
    )
  }

  // The envelope is modelled as a dead load hung on the frame: it changes
  // weight, and through weight overturning and sliding, but it carries no
  // lateral load and so cannot change drift. Said out loud because a student
  // who has just glazed a whole tower will reasonably expect it to sway more.
  if (
    structure.storeys.some(
      (storey) => FACADE[storey.facade].windowToWallRatio > 0,
    )
  ) {
    warnings.push(
      'Windows are non-structural here. Glazing changes weight, and through ' +
        'it overturning and sliding, but the lateral system is modelled as a ' +
        'core or frame, so openings do not change stiffness or drift.',
    )
  }

  return warnings
}

function loadingFor(
  structure: Structure,
  hazard: Hazard,
  inputs: BuildingInputs,
): HazardLoading {
  switch (hazard.kind) {
    case 'wind':
      return windLoading(structure, hazard, inputs)
    case 'seismic':
      return seismicLoading(structure, hazard, inputs)
    case 'flood':
      return floodLoading(structure, hazard, inputs)
    default: {
      const exhaustive: never = hazard
      throw new Error(`unsupported hazard kind: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/**
 * Analyse a structure against a hazard.
 *
 * The switch in `loadingFor` is the extension point: a new hazard adds a
 * module and a `case`, and no call site changes.
 */
export function analyze(
  structure: Structure,
  hazard: Hazard,
  library: MaterialLibrary,
): AnalysisResult {
  validate(structure, hazard)

  const inputs = buildingInputs(structure, library)
  const { geometry, materials, quantities, envelopes } = inputs
  const loading = loadingFor(structure, hazard, inputs)
  const warnings = [...loading.warnings, ...designWarnings(structure, materials)]
  const { loads } = loading

  // --- Cumulative shear and moment, accumulated top-down ------------------
  // Lever arms come from each load's own elevation rather than from the
  // storey's mid-height, because a flood's resultant sits low in the storey
  // the water surface passes through. For wind and seismic the two are the
  // same number.
  const n = structure.storeys.length
  const storeyShear_kN: number[] = new Array<number>(n).fill(0)
  const momentAboveBase_kNm: number[] = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i -= 1) {
    const g = geometry[i]
    if (g === undefined) throw new Error('index mismatch')
    let shear = 0
    let moment = 0
    for (let j = i; j < n; j += 1) {
      const lj = loads[j]
      if (lj === undefined) throw new Error('index mismatch')
      shear += lj.lateralForce_kN
      moment += lj.lateralForce_kN * (lj.loadElevation_m - g.baseElevation_m)
    }
    storeyShear_kN[i] = shear
    momentAboveBase_kNm[i] = moment
  }

  // --- Assemble per-storey results ---------------------------------------
  const storeys: StoreyResult[] = structure.storeys.map((storey, i) => {
    const g = geometry[i]
    const load = loads[i]
    const material = materials[i]
    const qty = quantities[i]
    const envelope = envelopes[i]
    const shear = storeyShear_kN[i]
    const moment = momentAboveBase_kNm[i]
    if (
      g === undefined || load === undefined || material === undefined ||
      qty === undefined || envelope === undefined ||
      shear === undefined || moment === undefined
    ) {
      throw new Error('index mismatch assembling storey results')
    }

    const drift = storeyDrift(storey, material.youngsModulus_GPa, shear, {
      amplification: loading.driftAmplification,
      limitRatio: loading.driftLimitRatio,
    })
    const projection = projectPlan(
      storey.widthX_m,
      storey.widthY_m,
      hazard.directionDeg,
      storey.planShape,
    )
    const fraction = STRUCTURAL_FRACTION[material.structuralClass][storey.lateralSystem]
    const sectionModulus = effectiveSectionModulus_m3(
      projection.acrossWindWidth_m,
      projection.alongWindDepth_m,
      fraction,
      storey.planShape,
    )
    const strengthUtil = strengthUtilization(
      moment,
      sectionModulus,
      material.yieldStrength_MPa,
    )
    const utilization = Math.max(drift.driftUtilization, strengthUtil)

    return {
      index: i,
      baseElevation_m: g.baseElevation_m,
      midHeight_m: g.midHeight_m,
      height_m: storey.height_m,
      // Present only where the hazard has such a figure. Spreading the load
      // would put `Kz: undefined` on a seismic storey; conditional spreads keep
      // the key absent entirely, which is what "this hazard has no such
      // quantity" should look like to anything reading it.
      ...(load.Kz === undefined ? {} : { Kz: load.Kz }),
      ...(load.velocityPressure_Pa === undefined
        ? {}
        : { velocityPressure_Pa: load.velocityPressure_Pa }),
      ...(load.submergedDepth_m === undefined
        ? {}
        : { submergedDepth_m: load.submergedDepth_m }),
      ...(load.buoyancy_kN === undefined ? {} : { buoyancy_kN: load.buoyancy_kN }),
      projectedArea_m2: load.projectedArea_m2,
      loadElevation_m: load.loadElevation_m,
      lateralForce_kN: load.lateralForce_kN,
      storeyShear_kN: shear,
      materialVolume_m3: qty.materialVolume_m3,
      // Frame plus envelope. The envelope's share follows, so nothing here
      // has to be taken on trust.
      selfWeight_kN: qty.selfWeight_kN + envelope.selfWeight_kN,
      embodiedCarbon_kgCO2e:
        qty.embodiedCarbon_kgCO2e + envelope.embodiedCarbon_kgCO2e,
      cost_usd: qty.cost_usd + envelope.cost_usd,
      facadeArea_m2: envelope.facadeArea_m2,
      facadeCarbon_kgCO2e: envelope.embodiedCarbon_kgCO2e,
      facadeCost_usd: envelope.cost_usd,
      facadeWeight_kN: envelope.selfWeight_kN,
      stiffness_kN_per_m: drift.stiffness_kN_per_m,
      drift_m: drift.drift_m,
      driftRatio: drift.driftRatio,
      exceedsDriftLimit: drift.exceedsDriftLimit,
      driftUtilization: drift.driftUtilization,
      strengthUtilization: strengthUtil,
      utilization,
      damage: 'intact',
    }
  })

  // --- Global stability ---------------------------------------------------
  // Overturning is taken about the leeward edge of the foundation, so the
  // lever arms come from the ground storey's plan.
  const groundStorey: Storey | undefined = structure.storeys[0]
  if (groundStorey === undefined) throw new Error('no ground storey')
  const basePlan = projectPlan(
    groundStorey.widthX_m,
    groundStorey.widthY_m,
    hazard.directionDeg,
    groundStorey.planShape,
  )

  const totalSelfWeight_kN = sumSelfWeight_kN(storeys.map((s) => s.selfWeight_kN))
  // Buoyancy is weight the building no longer has: it lifts, so it stops
  // resisting overturning and stops pressing the base into the soil. Floored
  // at zero because a building lighter than the water it displaces has no
  // friction left to lose — it is floating, which the flotation check reports
  // as its own failure rather than as a negative resistance.
  const effectiveWeight_kN = Math.max(totalSelfWeight_kN - loading.buoyancy_kN, 0)
  const baseShear_kN = storeyShear_kN[0] ?? 0
  const otMoment = overturningMoment_kNm(
    storeys.map((s) => s.lateralForce_kN),
    storeys.map((s) => s.loadElevation_m),
  )
  const rmWeight = restoringMomentSelfWeight_kNm(
    effectiveWeight_kN,
    basePlan.alongWindDepth_m,
  )
  const rmAnchor = restoringMomentAnchorage_kNm(
    structure.foundation.anchorCapacity_kN,
    basePlan.alongWindDepth_m,
  )
  const friction = frictionResistance_kN(effectiveWeight_kN)
  const passive = passiveResistance_kN(
    structure.foundation,
    basePlan.acrossWindWidth_m,
  )

  const isFlood = hazard.kind === 'flood'
  const fosFlotation = flotationSafetyFactor(
    totalSelfWeight_kN,
    structure.foundation.anchorCapacity_kN,
    loading.buoyancy_kN,
  )

  const stability: StabilityResult = {
    baseShear_kN,
    overturningMoment_kNm: otMoment,
    restoringMomentSelfWeight_kNm: rmWeight,
    restoringMomentAnchorage_kNm: rmAnchor,
    restoringMoment_kNm: rmWeight + rmAnchor,
    factorOfSafetyOverturning: safetyFactor(rmWeight + rmAnchor, otMoment),
    slidingResistanceFriction_kN: friction,
    slidingResistancePassive_kN: passive,
    slidingResistance_kN: friction + passive,
    factorOfSafetySliding: safetyFactor(friction + passive, baseShear_kN),
    totalSelfWeight_kN,
    ...(isFlood
      ? {
          buoyancy_kN: loading.buoyancy_kN,
          effectiveWeight_kN,
          factorOfSafetyFlotation: fosFlotation,
        }
      : {}),
    alongWindDepth_m: basePlan.alongWindDepth_m,
    acrossWindWidth_m: basePlan.acrossWindWidth_m,
  }

  // --- ScoreCard ----------------------------------------------------------
  const worstDriftRatio = storeys.reduce((m, s) => Math.max(m, s.driftRatio), 0)
  const worstStrength = storeys.reduce((m, s) => Math.max(m, s.strengthUtilization), 0)

  const checks: Array<readonly [FailureMode, number]> = [
    ['overturning', TARGET_SAFETY_FACTOR / stability.factorOfSafetyOverturning],
    ['sliding', TARGET_SAFETY_FACTOR / stability.factorOfSafetySliding],
    ['drift', worstDriftRatio / loading.driftLimitRatio],
    ['storey-strength', worstStrength],
  ]
  if (isFlood) {
    checks.push(['flotation', TARGET_SAFETY_FACTOR / fosFlotation])
  }

  const scoreCard: ScoreCard = {
    safetyFactor: Math.min(
      stability.factorOfSafetyOverturning,
      stability.factorOfSafetySliding,
      isFlood ? fosFlotation : Number.POSITIVE_INFINITY,
    ),
    carbonKg: storeys.reduce((sum, s) => sum + s.embodiedCarbon_kgCO2e, 0),
    costUsd: storeys.reduce((sum, s) => sum + s.cost_usd, 0),
    driftRatio: worstDriftRatio,
    governingFailureMode: governingMode(checks),
  }

  // Banded from the utilisations just computed, so the picture the simulation
  // draws and the numbers in the table are the same reading.
  const damage = assessDamage(storeys, scoreCard, hazard.kind)
  storeys.forEach((storey, i) => {
    storey.damage = damage.storeys[i] ?? 'intact'
  })

  return {
    hazardKind: hazard.kind,
    storeys,
    stability,
    scoreCard,
    driftLimitRatio: loading.driftLimitRatio,
    damage,
    warnings,
  }
}
