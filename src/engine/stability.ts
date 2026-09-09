/**
 * Global stability: overturning and sliding, plus per-storey bending demand.
 *
 * All moments are taken about the leeward base edge of the foundation — the
 * hinge the building would rotate about if the wind pushed it over.
 */

import type { Foundation, PlanShape } from './types.ts'
import {
  FOUNDATION_FRICTION_COEFFICIENT,
  PASSIVE_MOBILISATION_FACTOR,
  PASSIVE_PRESSURE_COEFFICIENT,
  SOIL_UNIT_WEIGHT_KN_M3,
} from './constants.ts'
import { grossSectionModulus_m3 } from './plan.ts'

/**
 * Overturning moment: each storey's wind force times its height above the
 * base.
 *   M_ot = sum( F_i * z_i )
 * with z_i the storey mid-height, where the force is taken to act.
 */
export function overturningMoment_kNm(
  forces_kN: readonly number[],
  leverArms_m: readonly number[],
): number {
  return forces_kN.reduce((sum, force, i) => {
    const arm = leverArms_m[i]
    if (arm === undefined) throw new Error('overturningMoment: length mismatch')
    return sum + force * arm
  }, 0)
}

/**
 * Restoring moment from self-weight.
 *   M_r = W * L/2
 * The total weight acts at the plan centroid, which is L/2 from the leeward
 * edge, where L is the plan depth parallel to the wind.
 *
 * ASSUMPTION: only structural self-weight is counted. Superimposed dead load
 * (facade, finishes, services) and any live load are ignored. That is
 * conservative for overturning — a real building has more stabilising mass —
 * and it is what makes the lightweight-tower-vs-squat-block comparison behave
 * the way structural intuition says it should.
 */
export function restoringMomentSelfWeight_kNm(
  totalSelfWeight_kN: number,
  alongWindDepth_m: number,
): number {
  return totalSelfWeight_kN * (alongWindDepth_m / 2)
}

/**
 * Restoring moment from foundation anchorage.
 *   M_a = T * L/2
 *
 * ASSUMPTION: `anchorCapacity_kN` is the total tension capacity of an anchor
 * group spread uniformly over the footprint, so its resultant acts at the plan
 * centroid — the same L/2 lever arm as the self-weight. Concentrating the same
 * capacity at the windward edge would give an arm of L and roughly double this
 * term; the uniform assumption is the conservative one.
 */
export function restoringMomentAnchorage_kNm(
  anchorCapacity_kN: number,
  alongWindDepth_m: number,
): number {
  return anchorCapacity_kN * (alongWindDepth_m / 2)
}

/**
 * Passive earth resistance on the embedded face of the foundation.
 *
 * Rankine passive pressure over depth d gives a resultant per unit width of
 *   P = 0.5 * Kp * gamma * d^2
 * acting over the width of the buried face. Multiplied by a mobilisation
 * factor because full passive pressure needs more wall movement than a
 * serviceable building can tolerate.
 */
export function passiveResistance_kN(
  foundation: Foundation,
  acrossWindWidth_m: number,
): number {
  const d = Math.max(foundation.embedmentDepth_m, 0)
  const perUnitWidth =
    0.5 * PASSIVE_PRESSURE_COEFFICIENT * SOIL_UNIT_WEIGHT_KN_M3 * d * d
  return perUnitWidth * acrossWindWidth_m * PASSIVE_MOBILISATION_FACTOR
}

/**
 * Sliding resistance: base friction plus mobilised passive pressure.
 *   R = mu * W + P_passive
 *
 * ASSUMPTION: anchors are treated as uplift-only and contribute nothing to
 * sliding. Many real hold-down systems do carry shear, so this is
 * conservative.
 */
export function frictionResistance_kN(totalSelfWeight_kN: number): number {
  return FOUNDATION_FRICTION_COEFFICIENT * totalSelfWeight_kN
}

/**
 * Elastic section modulus of the storey's lateral system about the axis it
 * bends over, reduced by the structural fraction.
 *
 * The plan is idealised as a solid section B wide (across wind) and L deep
 * (along wind) bending about the across-wind axis — B*L^2/6 for a rectangle,
 * pi*B*L^2/32 for an ellipse, both in `plan.ts` — and only
 * `structuralFraction` of that plan is real material:
 *   S_eff = fraction * S_gross
 *
 * SIMPLIFICATION: this smears the structural material uniformly across the
 * plan. A real lateral system concentrates material at the perimeter, where
 * it is far more effective, so S_eff here is conservative — often by a factor
 * of two or more. It is used for relative per-storey utilisation, not for
 * member sizing.
 */
export function effectiveSectionModulus_m3(
  acrossWindWidth_m: number,
  alongWindDepth_m: number,
  structuralFraction: number,
  planShape: PlanShape,
): number {
  return (
    structuralFraction *
    grossSectionModulus_m3(acrossWindWidth_m, alongWindDepth_m, planShape)
  )
}

/**
 * Bending stress utilisation at the base of one storey.
 *   sigma = M / S_eff,   utilisation = sigma / f_y
 * M is the moment from all wind forces above this storey's base.
 */
export function strengthUtilization(
  momentAboveBase_kNm: number,
  sectionModulus_m3: number,
  yieldStrength_MPa: number,
): number {
  if (sectionModulus_m3 <= 0) return Number.POSITIVE_INFINITY
  // kNm / m^3 = kPa; /1000 -> MPa.
  const stress_MPa = momentAboveBase_kNm / sectionModulus_m3 / 1000
  return stress_MPa / yieldStrength_MPa
}

/** Total structural self-weight of a stack of storeys. */
export function sumSelfWeight_kN(weights_kN: readonly number[]): number {
  return weights_kN.reduce((a, b) => a + b, 0)
}

/** Convenience guard so a zero demand reports as infinitely safe, not NaN. */
export function safetyFactor(capacity: number, demand: number): number {
  if (demand <= 0) return Number.POSITIVE_INFINITY
  return capacity / demand
}
