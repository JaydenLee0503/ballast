/**
 * Flood loading: ASCE 7-16 Chapter 5, with the commentary's hydrodynamic term.
 *
 * THE SHAPE OF THE ANSWER, again, is the lesson. Wind loads the top of a
 * building and an earthquake loads its mass; a flood loads the *bottom*, and
 * the deeper it gets the more of the load sits in the lowest few metres. So the
 * tall slender tower that struggles in a gale is barely troubled by a flood,
 * and the squat heavy warehouse that shrugs off wind finds itself with a
 * hundred tonnes of water pushing on one wall.
 *
 * And then there is the part nobody expects: buoyancy. A building displaces
 * water, water pushes back, and the lighter the building the more of its weight
 * disappears. A timber house in three metres of water can weigh less than
 * nothing — which is why flood-zone houses are strapped to their foundations
 * and why the flotation check here is its own failure mode rather than a term
 * inside the overturning one.
 *
 * Three loads, all from Chapter 5:
 *
 *   hydrostatic   p = gamma_w * (d - z), triangular, resultant at d/3 above
 *                 grade for a fully submerged wall. §5.4.2.
 *   hydrodynamic  F = 0.5 * Cd * rho_w * V^2 * A, uniform over the submerged
 *                 area. Eq. C5.4-3.
 *   buoyancy      F = gamma_w * displaced volume, straight up. §5.4.2.
 *
 * What is deliberately absent — breaking waves, debris impact, scour, wind
 * acting at the same time — is listed in constants.ts and warned about by
 * `analyze()`. Waves in particular can multiply the lateral load severalfold
 * in a coastal zone, so a result here is a riverine flood, not a storm surge.
 */

import type { FloodHazard, Storey } from './types.ts'
import {
  BUOYANT_VOLUME_FRACTION,
  FLOOD_DRAG_COEFFICIENT_TABLE,
  GRAVITY_M_S2,
  WATER_UNIT_WEIGHT_KN_M3,
} from './constants.ts'
import { interpolatePairs } from './interpolate.ts'
import { planArea_m2, projectPlan } from './plan.ts'

/**
 * Drag coefficient Cd, ASCE 7-16 Table C5.4-1, on the ratio of the obstructed
 * width to the stillwater depth. A wall that is wide relative to the water is
 * closer to a dam than to a pier and sheds flow less easily, so Cd rises.
 */
export function floodDragCoefficient(
  obstructedWidth_m: number,
  stillwaterDepth_m: number,
): number {
  if (stillwaterDepth_m <= 0) return 0
  return interpolatePairs(
    FLOOD_DRAG_COEFFICIENT_TABLE,
    obstructedWidth_m / stillwaterDepth_m,
  )
}

export interface StoreyFloodLoad {
  /** How far up this storey the water stands. 0 if it is above the surface. */
  submergedDepth_m: number
  /** Submerged area of the loaded face. */
  projectedArea_m2: number
  /** Hydrostatic plus hydrodynamic, on this storey. */
  lateralForce_kN: number
  /**
   * Elevation above grade at which that resultant acts — the centroid of the
   * combined pressure over the submerged part of this storey, NOT its
   * mid-height. In the storey where the water surface sits, the pressure is
   * triangular and the resultant is low; using mid-height there would
   * overstate the overturning moment by a third.
   */
  loadElevation_m: number
  /** Upward force from the water this storey's submerged volume displaces. */
  buoyancy_kN: number
}

/**
 * Flood load on one storey, given the elevations of its base and top.
 *
 * The hydrostatic integral is done in closed form rather than sampled, because
 * the storey where the surface lands is partly submerged and a mid-height
 * approximation is wrong exactly there. With `a = d - base` and
 * `b = d - min(top, d)` (both clamped at zero):
 *
 *   F   = gamma_w * (a^2 - b^2) / 2                     per unit width
 *   M   = gamma_w * [ d(a^2 - b^2)/2 - (a^3 - b^3)/3 ]  about grade
 *
 * and the centroid is M/F. At full submersion of a single storey from grade
 * (b = 0, a = d = h) these give the textbook gamma h^2/2 at h/3.
 */
export function storeyFloodLoad(
  storey: Storey,
  baseElevation_m: number,
  hazard: FloodHazard,
  totalObstructedWidth_m: number,
): StoreyFloodLoad {
  const projection = projectPlan(
    storey.widthX_m,
    storey.widthY_m,
    hazard.directionDeg,
    storey.planShape,
  )
  const width = projection.acrossWindWidth_m
  const top_m = baseElevation_m + storey.height_m
  const depth = Math.max(hazard.depth_m, 0)
  const submergedTop_m = Math.min(top_m, depth)
  const submergedDepth_m = Math.max(submergedTop_m - baseElevation_m, 0)

  if (submergedDepth_m <= 0) {
    return {
      submergedDepth_m: 0,
      projectedArea_m2: 0,
      lateralForce_kN: 0,
      loadElevation_m: baseElevation_m + storey.height_m / 2,
      buoyancy_kN: 0,
    }
  }

  const a = depth - baseElevation_m
  const b = depth - submergedTop_m
  // Per unit width, then across the face the flow meets.
  const hydrostatic_kN =
    ((WATER_UNIT_WEIGHT_KN_M3 * (a * a - b * b)) / 2) * width
  const hydrostaticMoment_kNm =
    WATER_UNIT_WEIGHT_KN_M3 *
    ((depth * (a * a - b * b)) / 2 - (a * a * a - b * b * b) / 3) *
    width

  const area_m2 = width * submergedDepth_m
  const cd = floodDragCoefficient(totalObstructedWidth_m, depth)
  // rho_w = gamma_w / g, so this is 0.5 * Cd * rho * V^2 * A with everything
  // in kN and metres. Uniform over the submerged strip, so its resultant sits
  // at the middle of that strip.
  const hydrodynamic_kN =
    0.5 *
    cd *
    (WATER_UNIT_WEIGHT_KN_M3 / GRAVITY_M_S2) *
    hazard.velocity_ms *
    hazard.velocity_ms *
    area_m2
  const hydrodynamicElevation_m = (baseElevation_m + submergedTop_m) / 2

  const lateralForce_kN = hydrostatic_kN + hydrodynamic_kN
  const loadElevation_m =
    lateralForce_kN > 0
      ? (hydrostaticMoment_kNm + hydrodynamic_kN * hydrodynamicElevation_m) /
        lateralForce_kN
      : baseElevation_m + storey.height_m / 2

  return {
    submergedDepth_m,
    projectedArea_m2: area_m2,
    lateralForce_kN,
    loadElevation_m,
    // Archimedes, on the part of this storey that is under water. The
    // displaced volume is discounted by BUOYANT_VOLUME_FRACTION because no
    // building is a sealed hull; see the note on that constant.
    buoyancy_kN:
      WATER_UNIT_WEIGHT_KN_M3 *
      planArea_m2(storey) *
      submergedDepth_m *
      BUOYANT_VOLUME_FRACTION,
  }
}

/**
 * The widest obstruction the flow meets, which is what Table C5.4-1 keys on.
 *
 * Taken over the submerged storeys only: a tower on a wide podium presents the
 * podium to a shallow flood and the tower to a deep one, and the drag
 * coefficient should follow the water rather than the silhouette.
 */
export function obstructedWidth_m(
  storeys: readonly Storey[],
  baseElevations_m: readonly number[],
  hazard: FloodHazard,
): number {
  let widest = 0
  storeys.forEach((storey, i) => {
    const base = baseElevations_m[i] ?? 0
    if (base >= hazard.depth_m) return
    const { acrossWindWidth_m } = projectPlan(
      storey.widthX_m,
      storey.widthY_m,
      hazard.directionDeg,
      storey.planShape,
    )
    widest = Math.max(widest, acrossWindWidth_m)
  })
  return widest
}

/**
 * Factor of safety against flotation: weight down over buoyancy up.
 *
 * Reported separately from overturning and sliding because it is a different
 * kind of failure with a different fix. A building that is about to tip can be
 * anchored at its windward edge; a building that is about to float has to be
 * made heavier, or be let flood inside so the water is on both sides of the
 * slab. ASCE 24 requires designing against it explicitly, which is why it gets
 * its own dial rather than being buried in an effective weight.
 */
export function flotationSafetyFactor(
  totalSelfWeight_kN: number,
  anchorCapacity_kN: number,
  buoyancy_kN: number,
): number {
  if (buoyancy_kN <= 0) return Number.POSITIVE_INFINITY
  return (totalSelfWeight_kN + anchorCapacity_kN) / buoyancy_kN
}
