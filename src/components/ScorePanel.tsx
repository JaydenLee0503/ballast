/**
 * The three dials.
 *
 * ScoreCard is three raw values and a failure mode, not a 0-100 score,
 * because collapsing safety, carbon and cost into one number hides the
 * tradeoff the whole exercise is about. The panel keeps them side by side and
 * refuses to rank them.
 *
 * Carbon and cost are shown as a total *and* an intensity per square metre.
 * Totals alone cannot compare a six-storey design against a twelve-storey
 * one: the taller building always loses on total and may well win on
 * intensity. `grossFloorArea_m2` comes from the engine so the denominator is
 * traceable too.
 *
 * Each dial also carries its change against the baseline. That delta is the
 * point of the exercise — "40% more safety for 18% more carbon" is the lesson;
 * three absolute numbers are only a readout — and it comes from
 * `compareDesigns` in the engine rather than from subtraction here, because a
 * percentage on screen is a number a student will quote.
 */

import {
  TARGET_SAFETY_FACTOR,
  grossFloorArea_m2,
  type AnalysisResult,
  type DesignComparison,
  type FailureMode,
  type MetricDelta,
  type Structure,
} from '@/engine'
import {
  formatCarbon,
  formatDriftRatio,
  formatSafetyFactor,
  formatSignedPercent,
  formatUsd,
} from '@/lib/format.ts'
import { BAND_HEX, BAND_INK_HEX, utilizationBand } from '@/lib/palette.ts'
import { HAZARD_LABEL } from '@/lib/hazard.ts'

const FAILURE_MODE_LABEL: Readonly<Record<FailureMode, string>> = {
  overturning: 'Overturning',
  sliding: 'Sliding at the base',
  drift: 'Excessive drift',
  'storey-strength': 'Storey strength',
  // Flood only. It is its own mode rather than a term inside overturning
  // because the fix is different: a building about to float has to be made
  // heavier or anchored down, not braced.
  flotation: 'Floating off its foundation',
  none: 'No limit exceeded',
}

/**
 * The change against the baseline.
 *
 * Green for better and red for worse, the same two colours the bars use, and
 * that overlap is deliberate rather than an accident to design around: a
 * design can improve on the baseline while still failing, and showing a green
 * delta above a red bar is the honest reading of that. The words "vs" and the
 * baseline's name are what separate the two meanings.
 */
function Delta({ delta }: { delta: MetricDelta | undefined }) {
  if (delta === undefined) return null

  // The ink variants, not the raw band hexes: this is small type on paper.
  const colour =
    delta.direction === 'better'
      ? BAND_INK_HEX.safe
      : delta.direction === 'worse'
        ? BAND_INK_HEX.fail
        : '#7b7490'

  return (
    <span
      className="ml-1.5 align-middle text-[0.7rem] font-bold tabular-nums"
      style={{ color: colour }}
    >
      {formatSignedPercent(delta.relativeChange)}
    </span>
  )
}

function Dial({
  label,
  value,
  sub,
  utilization,
  note,
  delta,
}: {
  label: string
  value: string
  sub: string
  /** Dimensionless demand/capacity, 1.0 = at the limit. Drives the bar. */
  utilization: number
  note?: string
  delta?: MetricDelta | undefined
}) {
  const band = utilizationBand(utilization)
  const fill = Math.max(0, Math.min(1, utilization))

  return (
    <div className="sticker p-3">
      <div className="font-pixel text-[0.7rem] uppercase tracking-widest text-ink/45">
        {label}
      </div>
      <div className="mt-1 font-display text-xl tabular-nums text-ink">
        {value}
        <Delta delta={delta} />
      </div>
      <div className="text-xs tabular-nums text-ink/50">{sub}</div>
      {/* The bar keeps the raw band hex, not the ink variant: it is a filled
          shape rather than type, and it is the one thing on this panel that
          has to read as the same colour as the storey it describes in 3D. */}
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full border-2 border-ink bg-paper">
        <div
          className="h-full transition-[width] duration-200"
          style={{ width: `${fill * 100}%`, backgroundColor: BAND_HEX[band] }}
        />
      </div>
      {note && <div className="mt-1.5 text-[0.65rem] text-ink/45">{note}</div>}
    </div>
  )
}

export interface ScorePanelProps {
  result: AnalysisResult
  structure: Structure
  /** Null when the design on screen *is* the baseline. */
  comparison: DesignComparison | null
  baselineLabel: string
  isBaseline: boolean
  /** The baseline was measured under a different hazard. See useComparison. */
  hazardMismatch: boolean
  onPinBaseline: () => void
  onResetBaseline: () => void
}

export function ScorePanel({
  result,
  structure,
  comparison,
  baselineLabel,
  isBaseline,
  hazardMismatch,
  onPinBaseline,
  onResetBaseline,
}: ScorePanelProps) {
  const { scoreCard, stability } = result
  const floorArea_m2 = grossFloorArea_m2(structure)
  const carbonIntensity = floorArea_m2 > 0 ? scoreCard.carbonKg / floorArea_m2 : 0
  const costIntensity = floorArea_m2 > 0 ? scoreCard.costUsd / floorArea_m2 : 0

  // Safety is inverted into a demand/capacity ratio so all four bars mean the
  // same thing: longer is worse, past the end is failure.
  const safetyUtilization = Number.isFinite(scoreCard.safetyFactor)
    ? TARGET_SAFETY_FACTOR / scoreCard.safetyFactor
    : 0
  // The limit this analysis was run against, not a constant: an earthquake is
  // checked at 0.020h and a storm at h/500, and printing the wind limit beside
  // a seismic drift would make a passing design look ten times over.
  const driftUtilization = scoreCard.driftRatio / result.driftLimitRatio
  const failing = scoreCard.governingFailureMode !== 'none'

  return (
    <section className="space-y-3">
      <div
        className="rounded-2xl border-2 px-3 py-2"
        style={{
          borderColor: failing ? BAND_INK_HEX.fail : BAND_INK_HEX.safe,
          backgroundColor: failing ? '#fdeceb' : '#e9f8ef',
          color: failing ? BAND_INK_HEX.fail : BAND_INK_HEX.safe,
        }}
      >
        <span className="font-pixel text-[0.7rem] tracking-widest opacity-70">
          GOVERNING · {HAZARD_LABEL[result.hazardKind].toUpperCase()}
        </span>
        <div className="font-display text-base">
          {FAILURE_MODE_LABEL[scoreCard.governingFailureMode]}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Dial
          label="Safety factor"
          value={formatSafetyFactor(scoreCard.safetyFactor)}
          sub={`target ${TARGET_SAFETY_FACTOR.toFixed(2)}`}
          utilization={safetyUtilization}
          note={`base shear ${stability.baseShear_kN.toFixed(0)} kN`}
          delta={comparison?.safetyFactor}
        />
        <Dial
          label="Worst drift"
          value={formatDriftRatio(scoreCard.driftRatio)}
          sub={`limit ${formatDriftRatio(result.driftLimitRatio)}`}
          utilization={driftUtilization}
          delta={comparison?.driftRatio}
        />
        <Dial
          label="Embodied carbon"
          value={formatCarbon(scoreCard.carbonKg)}
          sub={`${carbonIntensity.toFixed(0)} kgCO2e/m²`}
          // No code limit on carbon, so the bar is scaled against a frame-only
          // reference of 200 kgCO2e/m2 -- a rough mid-rise benchmark, shown so
          // the bar has meaning. It is a yardstick, not a pass/fail.
          utilization={carbonIntensity / 200}
          note="A1-A3, frame only"
          delta={comparison?.carbonKg}
        />
        <Dial
          label="Cost"
          value={formatUsd(scoreCard.costUsd)}
          sub={`${formatUsd(costIntensity)}/m²`}
          // Same idea: $400/m2 of frame as the yardstick.
          utilization={costIntensity / 400}
          note="indicative rates"
          delta={comparison?.costUsd}
        />
      </div>

      {/* What the percentages are measured against. Without this line a delta
          is an unattributed claim -- "+18%" is only meaningful once you know
          against what, and the answer changes when a design is opened. */}
      <div className="flex items-center gap-2 text-[0.65rem] text-ink/55">
        {isBaseline ? (
          <span className="truncate">
            This is the baseline · {baselineLabel}
          </span>
        ) : hazardMismatch ? (
          /* Says why there are no percentages rather than leaving them
             silently absent. A delta across two different events is not a
             reading of the design — see `useComparison.hazardMismatch`. */
          <span className="truncate">
            <span className="font-bold text-ink">{baselineLabel}</span> was
            measured under a different hazard · pin this one to compare
          </span>
        ) : (
          <span className="truncate">
            vs <span className="font-bold text-ink">{baselineLabel}</span>
            {comparison !== null &&
              comparison.currentGoverningFailureMode !==
                comparison.baselineGoverningFailureMode && (
                <span className="text-caution-ink">
                  {' '}
                  · governing mode changed
                </span>
              )}
          </span>
        )}
        <button
          type="button"
          onClick={onPinBaseline}
          disabled={isBaseline}
          className="ml-auto shrink-0 rounded-full border-2 border-ink/15 bg-white px-2 py-0.5 hover:border-ink disabled:opacity-40 disabled:hover:border-ink/15"
        >
          Pin current
        </button>
        <button
          type="button"
          onClick={onResetBaseline}
          className="shrink-0 rounded-full border-2 border-ink/15 bg-white px-2 py-0.5 hover:border-ink"
        >
          Reset
        </button>
      </div>

      <dl className="slab grid grid-cols-3 gap-3 p-3 text-xs">
        {[
          ['Storeys', String(structure.storeys.length)],
          ['Floor area', `${Math.round(floorArea_m2).toLocaleString('en-US')} m²`],
          // A flood has a third global check and it is the interesting one, so
          // it takes the slot rather than being hidden behind overturning.
          stability.factorOfSafetyFlotation === undefined
            ? ['Overturning', formatSafetyFactor(stability.factorOfSafetyOverturning)]
            : ['Flotation', formatSafetyFactor(stability.factorOfSafetyFlotation)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="font-pixel text-[0.65rem] uppercase tracking-widest text-ink/45">
              {label}
            </dt>
            <dd className="mt-0.5 font-display tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
