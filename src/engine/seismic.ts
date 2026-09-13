/**
 * Seismic loading: the ASCE 7-16 Equivalent Lateral Force procedure (§12.8).
 *
 * THE SHAPE OF THE ANSWER IS THE LESSON. Wind is a pressure on a surface, so
 * it grows with the area you present and with height, and the way to fight it
 * is to be narrow and stiff. An earthquake is an acceleration applied to a
 * mass, so it grows with how *heavy* you are — and the way to fight it is to be
 * light and ductile. The two hazards therefore reward opposite designs, and a
 * student who turns the same building from one to the other sees that in a
 * single click. That is the whole reason this module exists.
 *
 * The chain, all of it from the standard:
 *
 *   Ss, S1 (mapped, the student's input)
 *     -> Fa, Fv          site coefficients, Tables 11.4-1 / 11.4-2
 *     -> SMS, SM1        Eqs. 11.4-1, 11.4-2
 *     -> SDS, SD1        two thirds of those, §11.4.4
 *     -> Cs              Eqs. 12.8-2 .. 12.8-6, capped by the period and
 *                        floored so a flexible building is not designed for
 *                        nothing
 *     -> V = Cs * W      Eq. 12.8-1
 *     -> Fx = Cvx * V    Eq. 12.8-11, the vertical distribution
 *
 * Simplifications are listed in constants.ts under the seismic heading rather
 * than repeated here. The two that bite hardest: the effective seismic weight
 * is only the frame and the facade, and only one horizontal direction is
 * evaluated at a time.
 */

import type {
  LateralSystem,
  SeismicHazard,
  SiteClass,
  StructuralClass,
} from './types.ts'
import {
  CS_ABSOLUTE_MINIMUM,
  CS_HIGH_S1_FACTOR,
  CS_HIGH_S1_THRESHOLD_G,
  CS_MINIMUM_SDS_FACTOR,
  DESIGN_ACCELERATION_FRACTION,
  FA_SS_POINTS,
  FA_TABLE,
  FV_S1_POINTS,
  FV_TABLE,
  IMPORTANCE_FACTOR_IE,
  K_EXPONENT_HIGH_PERIOD_S,
  K_EXPONENT_LOW_PERIOD_S,
  LONG_PERIOD_TRANSITION_S,
  PERIOD_CONCRETE_MOMENT_FRAME,
  PERIOD_OTHER,
  PERIOD_STEEL_MOMENT_FRAME,
  SEISMIC_SYSTEM_FACTORS,
  type PeriodParameters,
} from './constants.ts'
import { interpolate } from './interpolate.ts'

/** Site coefficients Fa and Fv for this site class and this seismicity. */
export function siteCoefficients(
  siteClass: SiteClass,
  Ss_g: number,
  S1_g: number,
): { Fa: number; Fv: number } {
  return {
    Fa: interpolate(FA_SS_POINTS, FA_TABLE[siteClass], Ss_g),
    Fv: interpolate(FV_S1_POINTS, FV_TABLE[siteClass], S1_g),
  }
}

export interface DesignSpectrum {
  Fa: number
  Fv: number
  /** MCE_R accelerations adjusted for the site, Eqs. 11.4-1 and 11.4-2. */
  SMS_g: number
  SM1_g: number
  /** Design accelerations, two thirds of the above. §11.4.4. */
  SDS_g: number
  SD1_g: number
}

export function designSpectrum(hazard: SeismicHazard): DesignSpectrum {
  const { Fa, Fv } = siteCoefficients(hazard.siteClass, hazard.Ss_g, hazard.S1_g)
  const SMS_g = Fa * hazard.Ss_g
  const SM1_g = Fv * hazard.S1_g
  return {
    Fa,
    Fv,
    SMS_g,
    SM1_g,
    SDS_g: DESIGN_ACCELERATION_FRACTION * SMS_g,
    SD1_g: DESIGN_ACCELERATION_FRACTION * SM1_g,
  }
}

/**
 * The period parameters for a building of this system and this material.
 *
 * ASCE 7-16 Table 12.8-2 distinguishes steel and concrete moment frames from
 * each other and lumps everything else under "all other structural systems".
 * This engine has a lateral system and a structural class, which is exactly
 * enough to make that distinction and no more.
 */
export function periodParameters(
  system: LateralSystem,
  structuralClass: StructuralClass,
): PeriodParameters {
  if (system !== 'moment-frame') return PERIOD_OTHER
  if (structuralClass === 'steel') return PERIOD_STEEL_MOMENT_FRAME
  if (structuralClass === 'concrete') return PERIOD_CONCRETE_MOMENT_FRAME
  // A timber or bamboo moment frame is not in Table 12.8-2 at all. "All other
  // structural systems" is the row the standard leaves for it, rather than
  // borrowing a coefficient calibrated against a different material.
  return PERIOD_OTHER
}

/**
 * Approximate fundamental period Ta = Ct * h^x. ASCE 7-16 Eq. 12.8-7.
 *
 * "Approximate" is the standard's own word: this is a height-based regression
 * over measured buildings, deliberately biased low so that the design force
 * comes out high. A computed period from a real model would be longer and the
 * force smaller, which §12.8.2 caps rather than permits outright.
 */
export function approximatePeriod_s(
  totalHeight_m: number,
  system: LateralSystem,
  structuralClass: StructuralClass,
): number {
  const { Ct, x } = periodParameters(system, structuralClass)
  return Ct * Math.pow(Math.max(totalHeight_m, 0), x)
}

/**
 * The R and Cd this building is designed with.
 *
 * ASCE 7-16 §12.2.3.1: where different systems are used over the height of a
 * building in the same direction, R may not exceed the lowest of them. So a
 * tower that is a moment frame everywhere except for one unbraced storey is
 * designed as though it were unbraced throughout — which is the standard
 * refusing to let a weak storey hide inside an average, and is exactly the
 * lesson a student who braces only the top half needs to meet.
 *
 * Cd is taken from the same system as the governing R rather than minimised
 * independently, because the pair describes one system's behaviour and mixing
 * two rows of the table describes nothing.
 */
export function governingSystem(
  systems: readonly LateralSystem[],
): LateralSystem {
  let governing: LateralSystem = 'moment-frame'
  let lowestR = Number.POSITIVE_INFINITY
  for (const system of systems) {
    const { R } = SEISMIC_SYSTEM_FACTORS[system]
    if (R < lowestR) {
      lowestR = R
      governing = system
    }
  }
  return governing
}

/**
 * Seismic response coefficient Cs, ASCE 7-16 Eqs. 12.8-2 through 12.8-6.
 *
 * The base value SDS/(R/Ie) is the flat plateau of the design spectrum: a
 * short, stiff building feels the full short-period acceleration. The cap
 * SD1/(T(R/Ie)) is the descending branch: a tall, flexible building sways
 * slowly, out of step with the ground, and feels less. The floors stop that
 * reduction running away — which is what the 1985 Mexico City and 1994
 * Northridge revisions of this clause were about.
 */
export function seismicResponseCoefficient(
  spectrum: DesignSpectrum,
  period_s: number,
  S1_g: number,
  R: number,
): number {
  const ratio = R / IMPORTANCE_FACTOR_IE
  const base = spectrum.SDS_g / ratio

  const cap =
    period_s <= 0
      ? Number.POSITIVE_INFINITY
      : period_s <= LONG_PERIOD_TRANSITION_S
        ? spectrum.SD1_g / (period_s * ratio)
        : (spectrum.SD1_g * LONG_PERIOD_TRANSITION_S) /
          (period_s * period_s * ratio)

  let cs = Math.min(base, cap)

  // Eq. 12.8-5: the general floor.
  cs = Math.max(
    cs,
    CS_MINIMUM_SDS_FACTOR * spectrum.SDS_g * IMPORTANCE_FACTOR_IE,
    CS_ABSOLUTE_MINIMUM,
  )
  // Eq. 12.8-6: a near-fault floor that only applies in the worst regions.
  if (S1_g >= CS_HIGH_S1_THRESHOLD_G) {
    cs = Math.max(cs, (CS_HIGH_S1_FACTOR * S1_g) / ratio)
  }
  return cs
}

/**
 * Vertical distribution exponent k. ASCE 7-16 §12.8.3.
 *
 * k = 1 gives an inverted triangle — force proportional to weight times
 * height, the first-mode shape of a stiff building. k = 2 is a parabola,
 * weighting the top far more heavily, because a long-period building whips.
 */
export function verticalDistributionExponent(period_s: number): number {
  if (period_s <= K_EXPONENT_LOW_PERIOD_S) return 1
  if (period_s >= K_EXPONENT_HIGH_PERIOD_S) return 2
  return (
    1 +
    (period_s - K_EXPONENT_LOW_PERIOD_S) /
      (K_EXPONENT_HIGH_PERIOD_S - K_EXPONENT_LOW_PERIOD_S)
  )
}

/**
 * Distribute the base shear up the building. ASCE 7-16 Eqs. 12.8-11, 12.8-12:
 *   Cvx = w_x h_x^k / sum(w_i h_i^k),  F_x = Cvx * V
 *
 * `heights_m` are storey mid-heights rather than floor levels, consistent with
 * how this engine treats a storey everywhere else: as a strip with its load
 * acting at its middle. On a real building the levels are where the mass
 * actually is; the difference is half a storey height and it moves nothing
 * that matters at this resolution.
 *
 * The degenerate case is real and reachable: a single storey at zero height
 * with k > 1 would divide by zero. A zero denominator falls back to
 * distributing by weight alone, which is what k = 0 means and what a
 * single-storey building experiences.
 */
export function distributeBaseShear_kN(
  baseShear_kN: number,
  weights_kN: readonly number[],
  heights_m: readonly number[],
  k: number,
): number[] {
  const terms = weights_kN.map((weight, i) => {
    const height = heights_m[i] ?? 0
    return weight * Math.pow(Math.max(height, 0), k)
  })
  const total = terms.reduce((sum, term) => sum + term, 0)
  if (total <= 0) {
    const weightTotal = weights_kN.reduce((sum, w) => sum + w, 0)
    if (weightTotal <= 0) return weights_kN.map(() => 0)
    return weights_kN.map((weight) => (baseShear_kN * weight) / weightTotal)
  }
  return terms.map((term) => (baseShear_kN * term) / total)
}

export interface SeismicDesign {
  spectrum: DesignSpectrum
  /** The system whose R governs the whole building. §12.2.3.1. */
  governingSystem: LateralSystem
  R: number
  Cd: number
  approximatePeriod_s: number
  /** Dimensionless: the fraction of the building's weight applied sideways. */
  seismicResponseCoefficient: number
  verticalDistributionExponent: number
  /** Effective seismic weight actually used, W in Eq. 12.8-1. */
  seismicWeight_kN: number
  baseShear_kN: number
  /** Per storey, bottom-to-top, summing to `baseShear_kN`. */
  storeyForces_kN: number[]
}

/**
 * The whole ELF procedure in one call.
 *
 * `storeyWeights_kN` is the dead weight of each storey — frame plus facade —
 * which is the only mass this engine knows about. See the note in constants.ts
 * on why that makes the base shear low.
 */
export function seismicDesign(
  hazard: SeismicHazard,
  totalHeight_m: number,
  systems: readonly LateralSystem[],
  groundStructuralClass: StructuralClass,
  storeyWeights_kN: readonly number[],
  storeyMidHeights_m: readonly number[],
): SeismicDesign {
  const spectrum = designSpectrum(hazard)
  const system = governingSystem(systems)
  const { R, Cd } = SEISMIC_SYSTEM_FACTORS[system]
  const period_s = approximatePeriod_s(totalHeight_m, system, groundStructuralClass)
  const cs = seismicResponseCoefficient(spectrum, period_s, hazard.S1_g, R)
  const seismicWeight_kN = storeyWeights_kN.reduce((sum, w) => sum + w, 0)
  const baseShear_kN = cs * seismicWeight_kN
  const k = verticalDistributionExponent(period_s)

  return {
    spectrum,
    governingSystem: system,
    R,
    Cd,
    approximatePeriod_s: period_s,
    seismicResponseCoefficient: cs,
    verticalDistributionExponent: k,
    seismicWeight_kN,
    baseShear_kN,
    storeyForces_kN: distributeBaseShear_kN(
      baseShear_kN,
      storeyWeights_kN,
      storeyMidHeights_m,
      k,
    ),
  }
}
