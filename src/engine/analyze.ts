/**
 * The engine entry point.
 *
 * `analyze(structure, hazard, library)` is the ONLY function the rest of the
 * app should need. It is pure: same inputs, same numbers, every time. Nothing
 * in this file consults a network, a clock, a random source, or a language
 * model — every value in the returned ScoreCard is traceable to a formula in
 * wind.ts / drift.ts / stability.ts / sustainability.ts and a constant with a
 * citation.
 */

import type {
  AnalysisResult,
  FailureMode,
  Hazard,
  MaterialLibrary,
  ScoreCard,
  StabilityResult,
  StoreyResult,
  Structure,
  WindHazard,
} from './types.ts'
import {
  BUILDABLE_SYSTEMS,
  DRIFT_LIMIT_RATIO,
  FACADE,
  KZ_HEIGHTS_M,
  RIGID_BUILDING_STOREY_LIMIT,
  STRUCTURAL_FRACTION,
  TARGET_SAFETY_FACTOR,
} from './constants.ts'
import { getMaterial } from './materials.ts'
import {
  checkRoughnessConsistency,
  projectPlan,
  storeyGeometry,
  storeyWindLoad,
} from './wind.ts'
import { storeyDrift } from './drift.ts'
import { facadeQuantities, storeyQuantities } from './sustainability.ts'
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
  if (!Number.isFinite(structure.foundation.embedmentDepth_m) || structure.foundation.embedmentDepth_m < 0) {
    throw new StructureValidationError('foundation.embedmentDepth_m must be >= 0')
  }
  if (!Number.isFinite(structure.foundation.anchorCapacity_kN) || structure.foundation.anchorCapacity_kN < 0) {
    throw new StructureValidationError('foundation.anchorCapacity_kN must be >= 0')
  }
  if (!Number.isFinite(hazard.gustSpeed_kmh) || hazard.gustSpeed_kmh < 0) {
    throw new StructureValidationError('hazard.gustSpeed_kmh must be >= 0')
  }
}

/**
 * Pick the governing failure mode.
 *
 * Every check is normalised to a demand/capacity ratio where 1.0 means "at the
 * limit", so the four are directly comparable:
 *   overturning / sliding : TARGET_SAFETY_FACTOR / FoS
 *   drift                 : driftRatio / (1/500)
 *   storey strength       : bending stress / yield strength
 * The largest ratio governs. If nothing exceeds 1.0, the structure passes and
 * the mode is 'none' — but the ratios are still what the UI should show,
 * because "passes at 0.98" is a very different design from "passes at 0.2".
 */
function governingMode(
  overturningRatio: number,
  slidingRatio: number,
  driftRatio: number,
  strengthRatio: number,
): FailureMode {
  const candidates: ReadonlyArray<readonly [FailureMode, number]> = [
    ['overturning', overturningRatio],
    ['sliding', slidingRatio],
    ['drift', driftRatio],
    ['storey-strength', strengthRatio],
  ]
  let worst: FailureMode = 'none'
  let worstRatio = 1
  for (const [mode, ratio] of candidates) {
    if (ratio > worstRatio) {
      worst = mode
      worstRatio = ratio
    }
  }
  return worst
}

/** Wind analysis. Split out so `analyze` stays a thin dispatcher. */
function analyzeWind(
  structure: Structure,
  hazard: WindHazard,
  library: MaterialLibrary,
): AnalysisResult {
  const warnings: string[] = []

  const roughnessWarning = checkRoughnessConsistency(
    structure.exposureCategory,
    hazard.terrainRoughness,
  )
  if (roughnessWarning !== null) warnings.push(roughnessWarning)

  const geometry = storeyGeometry(structure)
  const totalHeight = geometry[geometry.length - 1]?.topElevation_m ?? 0

  if (structure.storeys.length > RIGID_BUILDING_STOREY_LIMIT) {
    warnings.push(
      `${structure.storeys.length} storeys exceeds the rigid-building ` +
        `assumption (G = 0.85) this engine relies on. A flexible-building ` +
        `gust factor would raise the loads; results under-predict.`,
    )
  }
  const kzTop = KZ_HEIGHTS_M[KZ_HEIGHTS_M.length - 1] ?? 0
  if (totalHeight > kzTop) {
    warnings.push(
      `Total height ${totalHeight.toFixed(1)} m is above the top of the ` +
        `ASCE 7 Kz table (${kzTop} m); Kz is clamped at its highest value.`,
    )
  }

  // --- Per-storey loads and quantities -----------------------------------
  const loads = geometry.map((g) =>
    storeyWindLoad(structure.exposureCategory, hazard, g),
  )
  const materials = structure.storeys.map((s) => getMaterial(library, s.materialId))

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

  const quantities = structure.storeys.map((storey, i) => {
    const material = materials[i]
    if (material === undefined) throw new Error('material index mismatch')
    return storeyQuantities(storey, material)
  })
  // Kept separate from the frame take-off all the way to the result, so the
  // per-storey split stays reportable rather than inferable.
  const envelopes = structure.storeys.map(facadeQuantities)

  // --- Cumulative shear and moment, accumulated top-down ------------------
  const n = structure.storeys.length
  const storeyShear_kN: number[] = new Array<number>(n).fill(0)
  const momentAboveBase_kNm: number[] = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i -= 1) {
    const g = geometry[i]
    const load = loads[i]
    if (g === undefined || load === undefined) throw new Error('index mismatch')
    let shear = 0
    let moment = 0
    for (let j = i; j < n; j += 1) {
      const gj = geometry[j]
      const lj = loads[j]
      if (gj === undefined || lj === undefined) throw new Error('index mismatch')
      shear += lj.lateralForce_kN
      moment += lj.lateralForce_kN * (gj.midHeight_m - g.baseElevation_m)
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

    const drift = storeyDrift(storey, material.youngsModulus_GPa, shear)
    const projection = projectPlan(storey.widthX_m, storey.widthY_m, hazard.directionDeg)
    const fraction = STRUCTURAL_FRACTION[material.structuralClass][storey.lateralSystem]
    const sectionModulus = effectiveSectionModulus_m3(
      projection.acrossWindWidth_m,
      projection.alongWindDepth_m,
      fraction,
    )
    const strengthUtil = strengthUtilization(
      moment,
      sectionModulus,
      material.yieldStrength_MPa,
    )

    return {
      index: i,
      baseElevation_m: g.baseElevation_m,
      midHeight_m: g.midHeight_m,
      height_m: storey.height_m,
      Kz: load.Kz,
      velocityPressure_Pa: load.velocityPressure_Pa,
      projectedArea_m2: load.projectedArea_m2,
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
      utilization: Math.max(drift.driftUtilization, strengthUtil),
    }
  })

  // --- Global stability ---------------------------------------------------
  // Overturning is taken about the leeward edge of the foundation, so the
  // lever arms come from the ground storey's plan.
  const groundStorey = structure.storeys[0]
  if (groundStorey === undefined) throw new Error('no ground storey')
  const basePlan = projectPlan(
    groundStorey.widthX_m,
    groundStorey.widthY_m,
    hazard.directionDeg,
  )

  const totalSelfWeight_kN = sumSelfWeight_kN(storeys.map((s) => s.selfWeight_kN))
  const baseShear_kN = storeyShear_kN[0] ?? 0
  const otMoment = overturningMoment_kNm(
    storeys.map((s) => s.lateralForce_kN),
    geometry.map((g) => g.midHeight_m),
  )
  const rmWeight = restoringMomentSelfWeight_kNm(
    totalSelfWeight_kN,
    basePlan.alongWindDepth_m,
  )
  const rmAnchor = restoringMomentAnchorage_kNm(
    structure.foundation.anchorCapacity_kN,
    basePlan.alongWindDepth_m,
  )
  const friction = frictionResistance_kN(totalSelfWeight_kN)
  const passive = passiveResistance_kN(
    structure.foundation,
    basePlan.acrossWindWidth_m,
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
    alongWindDepth_m: basePlan.alongWindDepth_m,
    acrossWindWidth_m: basePlan.acrossWindWidth_m,
  }

  // --- ScoreCard ----------------------------------------------------------
  const worstDriftRatio = storeys.reduce((m, s) => Math.max(m, s.driftRatio), 0)
  const worstStrength = storeys.reduce((m, s) => Math.max(m, s.strengthUtilization), 0)

  const scoreCard: ScoreCard = {
    safetyFactor: Math.min(
      stability.factorOfSafetyOverturning,
      stability.factorOfSafetySliding,
    ),
    carbonKg: storeys.reduce((sum, s) => sum + s.embodiedCarbon_kgCO2e, 0),
    costUsd: storeys.reduce((sum, s) => sum + s.cost_usd, 0),
    driftRatio: worstDriftRatio,
    governingFailureMode: governingMode(
      TARGET_SAFETY_FACTOR / stability.factorOfSafetyOverturning,
      TARGET_SAFETY_FACTOR / stability.factorOfSafetySliding,
      worstDriftRatio / DRIFT_LIMIT_RATIO,
      worstStrength,
    ),
  }

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

  return { hazardKind: 'wind', storeys, stability, scoreCard, warnings }
}

/**
 * Analyse a structure against a hazard.
 *
 * The switch on `hazard.kind` is the extension point: seismic, flood and
 * wildfire each add a branch and a module, and no call site changes.
 */
export function analyze(
  structure: Structure,
  hazard: Hazard,
  library: MaterialLibrary,
): AnalysisResult {
  validate(structure, hazard)
  switch (hazard.kind) {
    case 'wind':
      return analyzeWind(structure, hazard, library)
    default: {
      const exhaustive: never = hazard.kind
      throw new Error(`unsupported hazard kind: ${String(exhaustive)}`)
    }
  }
}
