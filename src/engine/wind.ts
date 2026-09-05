/**
 * Wind loading: ASCE 7-16 style, simplified.
 *
 * Scope and simplifications, stated once so the rest of the file can be terse:
 *   - Directional Procedure (ASCE 7-16 Ch. 27) for an enclosed rectangular
 *     building, reduced to a net windward+leeward force coefficient.
 *   - Rigid building (G = 0.85). Flexible-building dynamics are not modelled.
 *   - Flat site (Kzt = 1.0). No topographic speed-up.
 *   - Internal pressure cancels for the MWFRS of an enclosed building and is
 *     therefore omitted.
 *   - No across-wind or torsional load cases (ASCE 7-16 Fig. 27.3-8 cases
 *     2-4). Only the along-wind case is evaluated, which is the case that
 *     governs overturning for the squat-to-moderate structures students build
 *     here.
 */

import type {
  ExposureCategory,
  Storey,
  Structure,
  WindHazard,
} from './types.ts'
import {
  CP_LEEWARD_TABLE,
  CP_WINDWARD,
  EXPOSURE_ROUGHNESS_M,
  G_GUST_EFFECT,
  KD_DIRECTIONALITY,
  KZ_HEIGHTS_M,
  KZ_MIN_HEIGHT_M,
  KZ_POWER_LAW,
  KZ_TABLE,
  KZT_TOPOGRAPHIC,
  VELOCITY_PRESSURE_CONSTANT,
} from './constants.ts'

/** km/h -> m/s. */
export function kmhToMs(speed_kmh: number): number {
  return speed_kmh / 3.6
}

/**
 * Linear interpolation on a monotonically increasing x-table, clamped at both
 * ends. Clamping matters: ASCE 7 does not tabulate Kz below 15 ft, and above
 * 500 ft this engine is out of its depth anyway (analyze() warns).
 */
function interpolate(
  xs: readonly number[],
  ys: readonly number[],
  x: number,
): number {
  const first = xs[0]
  const firstY = ys[0]
  const lastIndex = xs.length - 1
  const last = xs[lastIndex]
  const lastY = ys[lastIndex]
  if (first === undefined || firstY === undefined || last === undefined || lastY === undefined) {
    throw new Error('interpolate: empty table')
  }
  if (x <= first) return firstY
  if (x >= last) return lastY
  for (let i = 0; i < lastIndex; i += 1) {
    const x0 = xs[i]
    const x1 = xs[i + 1]
    const y0 = ys[i]
    const y1 = ys[i + 1]
    if (x0 === undefined || x1 === undefined || y0 === undefined || y1 === undefined) {
      throw new Error('interpolate: ragged table')
    }
    if (x >= x0 && x <= x1) {
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0)
      return y0 + t * (y1 - y0)
    }
  }
  return lastY
}

/**
 * Velocity pressure exposure coefficient Kz at height z.
 *
 * ASCE 7-16 Table 26.10-1 (Case 2), linearly interpolated between tabulated
 * heights. Below 4.6 m (15 ft) the table's lowest row governs, per the note
 * on that table.
 */
export function velocityPressureExposureCoefficient(
  exposure: ExposureCategory,
  height_m: number,
): number {
  const column = KZ_TABLE[exposure]
  const z = Math.max(height_m, KZ_MIN_HEIGHT_M)
  return interpolate(KZ_HEIGHTS_M, column, z)
}

/**
 * The power law that ASCE 7-16 Table 26.10-1 discretises:
 *   Kz = 2.01 * (z / zg)^(2/alpha)
 * Exported so tests can verify the hand-typed table against it.
 */
export function kzFromPowerLaw(
  exposure: ExposureCategory,
  height_m: number,
): number {
  const { alpha, zg_m } = KZ_POWER_LAW[exposure]
  const z = Math.max(height_m, KZ_MIN_HEIGHT_M)
  return 2.01 * Math.pow(z / zg_m, 2 / alpha)
}

/**
 * Velocity pressure. ASCE 7-16 Eq. 26.10-1 in SI:
 *   qz = 0.613 * Kz * Kzt * Kd * V^2      [Pa, V in m/s]
 */
export function velocityPressure_Pa(
  exposure: ExposureCategory,
  height_m: number,
  gustSpeed_kmh: number,
): number {
  const v_ms = kmhToMs(gustSpeed_kmh)
  const kz = velocityPressureExposureCoefficient(exposure, height_m)
  return (
    VELOCITY_PRESSURE_CONSTANT *
    kz *
    KZT_TOPOGRAPHIC *
    KD_DIRECTIONALITY *
    v_ms *
    v_ms
  )
}

export interface PlanProjection {
  /** Width of the face the wind sees (perpendicular to the wind). */
  acrossWindWidth_m: number
  /** Plan depth parallel to the wind; the overturning lever arm base. */
  alongWindDepth_m: number
}

/**
 * Project a rectangular plan onto the wind direction.
 *
 * For a rectangle of sides (a, b) and wind at bearing theta (0 = blowing
 * along +X), the width of the shadow cast perpendicular to the wind is the
 * bounding-box projection
 *   B = a*|sin theta| + b*|cos theta|
 * and the depth along the wind is
 *   L = a*|cos theta| + b*|sin theta|
 * At theta = 0 the wind blows along X, so it strikes the face of width
 * widthY and travels through a depth widthX — which is what these reduce to.
 *
 * SIMPLIFICATION: at skew angles this bounding-box width overestimates the
 * true projected area of the building slightly, which is conservative.
 */
export function projectPlan(
  widthX_m: number,
  widthY_m: number,
  directionDeg: number,
): PlanProjection {
  const theta = (directionDeg * Math.PI) / 180
  const s = Math.abs(Math.sin(theta))
  const c = Math.abs(Math.cos(theta))
  return {
    acrossWindWidth_m: widthX_m * s + widthY_m * c,
    alongWindDepth_m: widthX_m * c + widthY_m * s,
  }
}

/**
 * Net force coefficient Cf = Cp,windward + |Cp,leeward|.
 *
 * ASCE 7-16 Fig. 27.3-1: windward Cp = +0.8 for all L/B; leeward Cp is
 * -0.5 for L/B <= 1, -0.3 at L/B = 2 and -0.2 for L/B >= 4, interpolated
 * between. A deep building (large L/B) sheds less suction off the back, so a
 * long slab presents a lower Cf when the wind blows down its length.
 */
export function netForceCoefficient(
  alongWindDepth_m: number,
  acrossWindWidth_m: number,
): number {
  const ratio = acrossWindWidth_m === 0 ? 0 : alongWindDepth_m / acrossWindWidth_m
  const ratios = CP_LEEWARD_TABLE.map(([r]) => r)
  const cps = CP_LEEWARD_TABLE.map(([, cp]) => cp)
  return CP_WINDWARD + interpolate(ratios, cps, ratio)
}

export interface StoreyGeometry {
  index: number
  storey: Storey
  baseElevation_m: number
  midHeight_m: number
  topElevation_m: number
}

/** Bottom-to-top elevations. `storeys[0]` sits on the foundation. */
export function storeyGeometry(structure: Structure): StoreyGeometry[] {
  const out: StoreyGeometry[] = []
  let base = 0
  for (const [index, storey] of structure.storeys.entries()) {
    out.push({
      index,
      storey,
      baseElevation_m: base,
      midHeight_m: base + storey.height_m / 2,
      topElevation_m: base + storey.height_m,
    })
    base += storey.height_m
  }
  return out
}

export interface StoreyWindLoad {
  Kz: number
  velocityPressure_Pa: number
  projectedArea_m2: number
  lateralForce_kN: number
}

/**
 * Lateral wind force on one storey:
 *   F = qz * G * Cf * A_projected      [N]
 * with qz evaluated at the storey's mid-height (ASCE 7 evaluates windward
 * pressure at each level's height; mid-height is the standard tributary-area
 * simplification for a storey strip).
 */
export function storeyWindLoad(
  exposure: ExposureCategory,
  hazard: WindHazard,
  geometry: StoreyGeometry,
): StoreyWindLoad {
  const { storey, midHeight_m } = geometry
  const projection = projectPlan(
    storey.widthX_m,
    storey.widthY_m,
    hazard.directionDeg,
  )
  const cf = netForceCoefficient(
    projection.alongWindDepth_m,
    projection.acrossWindWidth_m,
  )
  const qz = velocityPressure_Pa(exposure, midHeight_m, hazard.gustSpeed_kmh)
  const area = projection.acrossWindWidth_m * storey.height_m
  const force_N = qz * G_GUST_EFFECT * cf * area
  return {
    Kz: velocityPressureExposureCoefficient(exposure, midHeight_m),
    velocityPressure_Pa: qz,
    projectedArea_m2: area,
    lateralForce_kN: force_N / 1000,
  }
}

/**
 * Check the hazard's stated roughness length against the roughness implied by
 * the declared exposure category.
 *
 * DESIGN DECISION: `exposureCategory` governs Kz, not `terrainRoughness`.
 * ASCE 7 defines exposure by category, and blending in a second, continuous
 * roughness input would produce numbers that no code clause backs. So z0 is
 * used as a consistency check that surfaces a warning to the student, and the
 * physics stays traceable to a single clause.
 */
export function checkRoughnessConsistency(
  exposure: ExposureCategory,
  terrainRoughness_m: number,
): string | null {
  const nominal = EXPOSURE_ROUGHNESS_M[exposure]
  if (terrainRoughness_m <= 0) {
    return `terrainRoughness must be a positive roughness length in metres; got ${terrainRoughness_m}.`
  }
  // An order of magnitude is the tolerance: z0 varies widely inside a category.
  const ratio = terrainRoughness_m / nominal
  if (ratio > 10 || ratio < 0.1) {
    const better = (['B', 'C', 'D'] as const).reduce((best, candidate) =>
      Math.abs(Math.log(terrainRoughness_m / EXPOSURE_ROUGHNESS_M[candidate])) <
      Math.abs(Math.log(terrainRoughness_m / EXPOSURE_ROUGHNESS_M[best]))
        ? candidate
        : best,
    )
    return (
      `terrainRoughness z0 = ${terrainRoughness_m} m is inconsistent with ` +
      `exposure ${exposure} (nominal z0 = ${nominal} m). Exposure ${better} ` +
      `matches this terrain better. Kz was computed from exposure ${exposure}.`
    )
  }
  return null
}
