/**
 * Turns an engine result into the fact sheet the model is allowed to see.
 *
 * This is the seam that enforces the project's one rule. The model never
 * receives a Structure it could reason forward from, or a formula it could
 * evaluate — it receives finished numbers that `analyze()` produced, already
 * rounded to the precision the UI displays. Its job is to explain them.
 *
 * Rounding here is not cosmetic. `guard.ts` checks the model's prose against
 * exactly these values, so rounding once, at the point the facts are built,
 * is what makes "did it quote us correctly?" a decidable question.
 */

import {
  DRIFT_LIMIT_RATIO,
  TARGET_SAFETY_FACTOR,
  grossFloorArea_m2,
  type AnalysisResult,
  type ExposureCategory,
  type MaterialLibrary,
  FACADE_SYSTEMS,
  type FacadeSystem,
  type Structure,
  type WindHazard,
} from '@/engine'
import { FACADE_LABEL } from '@/lib/facade.ts'
import type { CritiqueContext, CritiqueStorey } from './types.ts'

/**
 * The same words the student is looking at. Sharing the label table with the
 * controls is the point: a suggestion that says "switch to punched windows"
 * should name the button, not an internal identifier.
 */
function facadeName(facade: FacadeSystem | undefined): string {
  return facade === undefined ? 'unknown' : FACADE_LABEL[facade]
}

const EXPOSURE_DESCRIPTION: Readonly<Record<ExposureCategory, string>> = {
  B: 'urban or suburban, numerous closely spaced obstructions',
  C: 'open terrain with scattered obstructions',
  D: 'flat unobstructed terrain or water, the most severe',
}

function round(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * Drift quoted as the denominator of h/N, the way the codes write it. A model
 * asked to repeat "0.0031" will drift a digit; asked to repeat "h/323" it
 * usually will not, and if it does the guard catches it.
 */
function driftDenominator(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return Infinity
  return Math.round(1 / ratio)
}

export function buildCritiqueContext(
  result: AnalysisResult,
  structure: Structure,
  hazard: WindHazard,
  library: MaterialLibrary,
): CritiqueContext {
  const { scoreCard, stability } = result
  const ground = structure.storeys[0]
  const totalHeight_m = structure.storeys.reduce(
    (total, storey) => total + storey.height_m,
    0,
  )
  const planX_m = ground?.widthX_m ?? 0
  const planY_m = ground?.widthY_m ?? 0
  const floorArea_m2 = grossFloorArea_m2(structure)
  const narrowest = Math.min(planX_m, planY_m)

  const storeys: CritiqueStorey[] = result.storeys.map((storey) => {
    const material = library.get(
      structure.storeys[storey.index]?.materialId ?? '',
    )
    return {
      label: storey.index + 1,
      materialName: material?.name ?? 'unknown',
      lateralSystem: structure.storeys[storey.index]?.lateralSystem ?? 'unknown',
      facadeName: facadeName(structure.storeys[storey.index]?.facade),
      lateralForce_kN: round(storey.lateralForce_kN, 1),
      storeyShear_kN: round(storey.storeyShear_kN, 1),
      driftDenominator: driftDenominator(storey.driftRatio),
      driftUtilization: round(storey.driftUtilization, 3),
      strengthUtilization: round(storey.strengthUtilization, 3),
      utilization: round(storey.utilization, 3),
    }
  })

  return {
    hazard: {
      gustSpeed_kmh: round(hazard.gustSpeed_kmh, 0),
      directionDeg: round(hazard.directionDeg, 0),
      exposureCategory: structure.exposureCategory,
      exposureDescription: EXPOSURE_DESCRIPTION[structure.exposureCategory],
    },
    building: {
      storeyCount: structure.storeys.length,
      totalHeight_m: round(totalHeight_m, 1),
      planX_m: round(planX_m, 1),
      planY_m: round(planY_m, 1),
      floorArea_m2: round(floorArea_m2, 0),
      // Height over the narrow plan dimension: the single number that best
      // predicts whether this thing is going to fall over.
      slendernessRatio: narrowest > 0 ? round(totalHeight_m / narrowest, 2) : 0,
      foundationType: structure.foundation.type,
      embedmentDepth_m: round(structure.foundation.embedmentDepth_m, 2),
      anchorCapacity_kN: round(structure.foundation.anchorCapacity_kN, 0),
    },
    score: {
      safetyFactor: round(scoreCard.safetyFactor, 2),
      carbon_kgCO2e: round(scoreCard.carbonKg, 0),
      carbonIntensity_kgCO2e_m2:
        floorArea_m2 > 0 ? round(scoreCard.carbonKg / floorArea_m2, 1) : 0,
      cost_usd: round(scoreCard.costUsd, 0),
      costIntensity_usd_m2:
        floorArea_m2 > 0 ? round(scoreCard.costUsd / floorArea_m2, 0) : 0,
      worstDriftRatio: round(scoreCard.driftRatio, 5),
      worstDriftDenominator: driftDenominator(scoreCard.driftRatio),
      governingFailureMode: scoreCard.governingFailureMode,
    },
    stability: {
      baseShear_kN: round(stability.baseShear_kN, 1),
      overturningMoment_kNm: round(stability.overturningMoment_kNm, 0),
      restoringMoment_kNm: round(stability.restoringMoment_kNm, 0),
      factorOfSafetyOverturning: round(stability.factorOfSafetyOverturning, 2),
      factorOfSafetySliding: round(stability.factorOfSafetySliding, 2),
      totalSelfWeight_kN: round(stability.totalSelfWeight_kN, 0),
    },
    limits: {
      targetSafetyFactor: TARGET_SAFETY_FACTOR,
      driftLimitDenominator: driftDenominator(DRIFT_LIMIT_RATIO),
    },
    storeys,
    facadeNames: FACADE_SYSTEMS.map(facadeName),
    materials: [...library.values()].map((material) => ({
      id: material.id,
      name: material.name,
      structuralClass: material.structuralClass,
      density_kg_m3: material.density_kg_m3,
      yieldStrength_MPa: material.yieldStrength_MPa,
      embodiedCarbon_kgCO2e_m3: round(material.embodiedCarbon_kgCO2e_m3, 0),
      cost_usd_m3: round(material.cost_usd_m3, 0),
    })),
    warnings: result.warnings,
  }
}
