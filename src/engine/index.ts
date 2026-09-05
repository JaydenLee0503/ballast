/**
 * Public surface of the simulation engine.
 *
 * Rule for the whole app: UI and AI layers import from '@/engine', never from
 * a module inside it. Nothing in `src/engine/` may import React, zustand,
 * Supabase, or anything else outside this folder.
 */

export * from './types.ts'
export { analyze, StructureValidationError } from './analyze.ts'
export {
  MATERIAL_LIBRARY,
  buildMaterialLibrary,
  getMaterial,
  MaterialDataError,
} from './materials.ts'
export * from './constants.ts'
export {
  kmhToMs,
  velocityPressure_Pa,
  velocityPressureExposureCoefficient,
  kzFromPowerLaw,
  projectPlan,
  netForceCoefficient,
  storeyGeometry,
  storeyWindLoad,
  checkRoughnessConsistency,
} from './wind.ts'
export { planArea_m2, storeyStiffness_kN_per_m, storeyDrift } from './drift.ts'
export {
  compareDesigns,
  metricDelta,
  type BetterWhen,
  type ChangeDirection,
  type DesignComparison,
  type DesignSnapshot,
  type MetricDelta,
} from './compare.ts'
export {
  grossVolume_m3,
  grossFloorArea_m2,
  structuralVolume_m3,
  storeyQuantities,
} from './sustainability.ts'
export {
  overturningMoment_kNm,
  restoringMomentSelfWeight_kNm,
  restoringMomentAnchorage_kNm,
  passiveResistance_kN,
  frictionResistance_kN,
  effectiveSectionModulus_m3,
  strengthUtilization,
  safetyFactor,
} from './stability.ts'
