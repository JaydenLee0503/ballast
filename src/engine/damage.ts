/**
 * What the simulation is allowed to draw.
 *
 * THIS IS NOT A SECOND ANALYSIS. Every value here is a banding of a figure
 * `analyze()` has already produced: a storey's `utilization` becomes a
 * `DamageState` the way `lib/palette.ts` turns the same number into one of
 * three colours, and the verdict reads the global checks the ScoreCard already
 * reports. Nothing is computed here that is not already decided.
 *
 * It lives in the engine rather than in the viewport for the reason everything
 * else does: "this storey collapsed" is a claim about the building. A component
 * that decided on its own which floors fall down would be inventing the most
 * dramatic number on screen, which is exactly the thing the one rule exists to
 * prevent. The animation may exaggerate *motion* — and says so on screen — but
 * it may not decide *outcome*.
 *
 * What it deliberately is not: a damage model. A real one needs a fragility
 * curve per component and a nonlinear analysis to drive it. This is a
 * linear-elastic engine, so what it can honestly say is "this storey is past
 * its limit, and by how much" — three bands of that, no more. See
 * `DAMAGE_THRESHOLDS`.
 */

import type {
  DamageReport,
  DamageState,
  FailureMode,
  ScoreCard,
  StoreyResult,
  SurvivalVerdict,
} from './types.ts'
import { DAMAGE_THRESHOLDS, TARGET_SAFETY_FACTOR } from './constants.ts'

/** The band of `utilization` a storey lands in. Non-finite reads as collapsed. */
export function damageState(utilization: number): DamageState {
  if (!Number.isFinite(utilization)) return 'collapsed'
  if (utilization >= DAMAGE_THRESHOLDS.collapsed) return 'collapsed'
  if (utilization >= DAMAGE_THRESHOLDS.severe) return 'severe'
  if (utilization >= DAMAGE_THRESHOLDS.cracked) return 'cracked'
  return 'intact'
}

/**
 * One plain sentence naming what gave way.
 *
 * Copy, not a calculation — it quotes the failure mode the ScoreCard already
 * chose and adds no judgement of its own. Written for someone who has just
 * watched their building fall over and wants to know why in one line.
 */
function headlineFor(
  verdict: SurvivalVerdict,
  mode: FailureMode,
  hazardKind: string,
): string {
  const event =
    hazardKind === 'wind'
      ? 'the storm'
      : hazardKind === 'seismic'
        ? 'the earthquake'
        : 'the flood'

  if (verdict === 'stands') {
    return `It stood up to ${event} with something in reserve.`
  }

  const cause: Readonly<Record<FailureMode, string>> = {
    overturning: 'it tipped about its leeward edge — not enough weight, too much lever arm',
    sliding: 'it slid off its foundation — the base could not hold the shear',
    drift: 'it leaned further than the limit allows — too flexible for the load',
    'storey-strength': 'a storey was bent past the strength of its material',
    flotation: 'it floated — the water displaced more weight than the building had',
    none: 'it was working close to its limits',
  }

  const lead = verdict === 'failed' ? 'It failed' : 'It survived, but it was damaged'
  return `${lead}: ${cause[mode]}.`
}

/**
 * Band every storey, then say how the building as a whole came out of it.
 *
 * The verdict is deliberately the *global* checks' answer rather than a count
 * of damaged storeys. A building whose storeys are all comfortable but whose
 * overturning factor is 0.8 has failed, and a simulation that drew it standing
 * because no storey went red would be lying about the most important number on
 * the panel.
 */
export function assessDamage(
  storeys: readonly StoreyResult[],
  scoreCard: ScoreCard,
  hazardKind: string,
): DamageReport {
  const states = storeys.map((storey) => damageState(storey.utilization))

  // A collapsed storey takes everything above it with it, so the lowest one is
  // the only index the viewport needs.
  const collapseIndex = states.findIndex((state) => state === 'collapsed')

  const globalFailure =
    Number.isFinite(scoreCard.safetyFactor) && scoreCard.safetyFactor < 1
  const overLimit = scoreCard.governingFailureMode !== 'none'

  const verdict: SurvivalVerdict =
    collapseIndex >= 0 || globalFailure
      ? 'failed'
      : overLimit || states.some((state) => state !== 'intact')
        ? 'damaged'
        : 'stands'

  return {
    verdict,
    storeys: states,
    collapseIndex: collapseIndex >= 0 ? collapseIndex : null,
    headline: headlineFor(verdict, scoreCard.governingFailureMode, hazardKind),
  }
}

/**
 * How much of the target safety factor is left, as a 0..1 fraction.
 *
 * Exported for the simulation's own readout, so that "how close was that?" is
 * answered with the same ratio the governing-mode check uses rather than with
 * a second definition of margin.
 */
export function safetyMargin(safetyFactor: number): number {
  if (!Number.isFinite(safetyFactor)) return 1
  if (safetyFactor <= 0) return 0
  return Math.max(0, Math.min(1, 1 - TARGET_SAFETY_FACTOR / safetyFactor))
}
