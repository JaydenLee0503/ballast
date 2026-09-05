/**
 * Comparing two designs.
 *
 * Three absolute dials tell a student where they are. They do not tell them
 * what their last twenty minutes of work bought, and that is the lesson: not
 * "carbon is 412 t" but "you gained 40% safety for 18% more carbon". The
 * tradeoff only becomes visible when there is something to trade against.
 *
 * This is in the engine, not in the panel that draws it, for the same reason
 * `grossFloorArea_m2` is: a percentage on screen is a number a student will
 * quote, and every number a student sees has to come from here. Doing the
 * subtraction in a component would put an untraceable figure on the screen
 * next to traceable ones.
 *
 * Nothing here knows which design is "the good one". It reports direction per
 * metric and refuses to total them up, because a single verdict would collapse
 * exactly the tradeoff it exists to show.
 */

import type { AnalysisResult, FailureMode, Structure } from './types.ts'
import { grossFloorArea_m2 } from './sustainability.ts'

/**
 * Which way is an improvement for a given metric. Domain knowledge, so it
 * lives with the domain: more safety is better, less carbon is better, and the
 * UI should not have to know which is which to colour a number.
 */
export type BetterWhen = 'higher' | 'lower'

export type ChangeDirection = 'better' | 'worse' | 'same' | 'unknown'

export interface MetricDelta {
  baseline: number
  current: number
  /** `current - baseline`. Null when either side is not finite. */
  absoluteChange: number | null
  /**
   * `(current - baseline) / baseline`, dimensionless. Null when the baseline
   * is zero or either side is not finite — an undefined ratio is reported as
   * undefined rather than as a large number that looks meaningful.
   */
  relativeChange: number | null
  direction: ChangeDirection
}

export interface DesignComparison {
  safetyFactor: MetricDelta
  driftRatio: MetricDelta
  carbonKg: MetricDelta
  costUsd: MetricDelta
  carbonIntensity_kgCO2e_m2: MetricDelta
  costIntensity_usd_m2: MetricDelta
  baselineGoverningFailureMode: FailureMode
  currentGoverningFailureMode: FailureMode
}

/** An analysed design: the result, and the structure it was computed from. */
export interface DesignSnapshot {
  result: AnalysisResult
  structure: Structure
}

/**
 * A safety factor is legitimately infinite — a building with no overturning
 * demand has no finite factor of safety — so non-finite values are a normal
 * input here, not an error. `Infinity` compares fine for direction and gives
 * no meaningful difference, which is exactly what the nulls say.
 */
export function metricDelta(
  baseline: number,
  current: number,
  betterWhen: BetterWhen,
): MetricDelta {
  const bothFinite = Number.isFinite(baseline) && Number.isFinite(current)
  const comparable = !Number.isNaN(baseline) && !Number.isNaN(current)

  let direction: ChangeDirection
  if (!comparable) direction = 'unknown'
  else if (baseline === current) direction = 'same'
  else direction = current > baseline === (betterWhen === 'higher') ? 'better' : 'worse'

  return {
    baseline,
    current,
    absoluteChange: bothFinite ? current - baseline : null,
    relativeChange:
      bothFinite && baseline !== 0 ? (current - baseline) / baseline : null,
    direction,
  }
}

/** Carbon or cost per square metre, or 0 for a structure with no floor area. */
function intensity(total: number, floorArea_m2: number): number {
  return floorArea_m2 > 0 ? total / floorArea_m2 : 0
}

export function compareDesigns(
  baseline: DesignSnapshot,
  current: DesignSnapshot,
): DesignComparison {
  const base = baseline.result.scoreCard
  const now = current.result.scoreCard
  const baseArea_m2 = grossFloorArea_m2(baseline.structure)
  const nowArea_m2 = grossFloorArea_m2(current.structure)

  return {
    safetyFactor: metricDelta(base.safetyFactor, now.safetyFactor, 'higher'),
    driftRatio: metricDelta(base.driftRatio, now.driftRatio, 'lower'),
    carbonKg: metricDelta(base.carbonKg, now.carbonKg, 'lower'),
    costUsd: metricDelta(base.costUsd, now.costUsd, 'lower'),
    // Intensities are the honest comparison across designs of different size:
    // a taller building loses on every total and may well win per square metre.
    carbonIntensity_kgCO2e_m2: metricDelta(
      intensity(base.carbonKg, baseArea_m2),
      intensity(now.carbonKg, nowArea_m2),
      'lower',
    ),
    costIntensity_usd_m2: metricDelta(
      intensity(base.costUsd, baseArea_m2),
      intensity(now.costUsd, nowArea_m2),
      'lower',
    ),
    baselineGoverningFailureMode: base.governingFailureMode,
    currentGoverningFailureMode: now.governingFailureMode,
  }
}
