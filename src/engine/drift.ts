/**
 * Storey drift.
 *
 * Model:
 *   k_storey = C_sys * E * A_plan / h        [N/m]
 *   drift    = V_storey / k_storey           [m]
 *   ratio    = drift / h                     [-]
 *
 * where V_storey is the cumulative wind shear carried by that storey (its own
 * force plus everything above it) and C_sys is an empirical calibration
 * constant per lateral system. See LATERAL_STIFFNESS_COEFFICIENT in
 * constants.ts for the calibration basis and its known limitations — chiefly
 * that C_sys does not vary with material, so material stiffness differences
 * show up undamped by the member sizing that would offset them in practice.
 *
 * Drift is checked against h/500 as required by the brief. For reference,
 * ASCE 7-16 Commentary CC.2.2 suggests h/600 to h/400 for wind on typical
 * buildings, so h/500 sits mid-range.
 */

import type { Storey } from './types.ts'
import { DRIFT_LIMIT_RATIO, LATERAL_STIFFNESS_COEFFICIENT } from './constants.ts'
// Plan area is shape-dependent and lives with the rest of the plan geometry, so
// a round storey is less stiff for the same reason it is lighter.
import { planArea_m2 } from './plan.ts'

/** Lateral stiffness of one storey, in kN/m. */
export function storeyStiffness_kN_per_m(
  storey: Storey,
  youngsModulus_GPa: number,
): number {
  const c = LATERAL_STIFFNESS_COEFFICIENT[storey.lateralSystem]
  const e_Pa = youngsModulus_GPa * 1e9
  const k_N_per_m = (c * e_Pa * planArea_m2(storey)) / storey.height_m
  return k_N_per_m / 1000
}

export interface StoreyDrift {
  stiffness_kN_per_m: number
  drift_m: number
  driftRatio: number
  exceedsDriftLimit: boolean
  driftUtilization: number
}

export function storeyDrift(
  storey: Storey,
  youngsModulus_GPa: number,
  storeyShear_kN: number,
): StoreyDrift {
  const stiffness = storeyStiffness_kN_per_m(storey, youngsModulus_GPa)
  const drift = stiffness > 0 ? storeyShear_kN / stiffness : Number.POSITIVE_INFINITY
  const ratio = drift / storey.height_m
  return {
    stiffness_kN_per_m: stiffness,
    drift_m: drift,
    driftRatio: ratio,
    exceedsDriftLimit: ratio > DRIFT_LIMIT_RATIO,
    driftUtilization: ratio / DRIFT_LIMIT_RATIO,
  }
}
