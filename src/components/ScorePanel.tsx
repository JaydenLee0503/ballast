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
  DRIFT_LIMIT_RATIO,
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
import { BAND_HEX, utilizationBand } from '@/lib/palette.ts'

const FAILURE_MODE_LABEL: Readonly<Record<FailureMode, string>> = {
  overturning: 'Overturning',
  sliding: 'Sliding at the base',
  drift: 'Excessive drift',
  'storey-strength': 'Storey strength',
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

  const colour =
    delta.direction === 'better'
      ? BAND_HEX.safe
      : delta.direction === 'worse'
        ? BAND_HEX.fail
        : undefined

  return (
    <span
      className="ml-1.5 align-middle text-[0.7rem] tabular-nums"
      style={colour !== undefined ? { color: colour } : { color: '#78716c' }}
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
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="text-[0.65rem] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-xl tabular-nums text-neutral-100">
        {value}
        <Delta delta={delta} />
      </div>
      <div className="text-xs tabular-nums text-neutral-500">{sub}</div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full rounded-full transition-[width] duration-200"
          style={{ width: `${fill * 100}%`, backgroundColor: BAND_HEX[band] }}
        />
      </div>
      {note && <div className="mt-1.5 text-[0.65rem] text-neutral-600">{note}</div>}
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
  onPinBaseline: () => void
  onResetBaseline: () => void
}

export function ScorePanel({
  result,
  structure,
  comparison,
  baselineLabel,
  isBaseline,
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
  const driftUtilization = scoreCard.driftRatio / DRIFT_LIMIT_RATIO
  const failing = scoreCard.governingFailureMode !== 'none'

  return (
    <section className="space-y-3">
      <div
        className="rounded-lg border px-3 py-2 text-sm"
        style={{
          borderColor: failing ? BAND_HEX.fail : BAND_HEX.safe,
          color: failing ? BAND_HEX.fail : BAND_HEX.safe,
        }}
      >
        <span className="text-[0.65rem] uppercase tracking-wider text-neutral-500">
          Governing
        </span>
        <div className="font-medium">
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
          sub={`limit ${formatDriftRatio(DRIFT_LIMIT_RATIO)}`}
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
      <div className="flex items-center gap-2 text-[0.65rem] text-neutral-600">
        {isBaseline ? (
          <span className="truncate">
            This is the baseline · {baselineLabel}
          </span>
        ) : (
          <span className="truncate">
            vs <span className="text-neutral-400">{baselineLabel}</span>
            {comparison !== null &&
              comparison.currentGoverningFailureMode !==
                comparison.baselineGoverningFailureMode && (
                <span className="text-caution">
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
          className="ml-auto shrink-0 rounded border border-neutral-800 px-1.5 py-0.5 hover:border-neutral-600 hover:text-neutral-300 disabled:opacity-40"
        >
          Pin current
        </button>
        <button
          type="button"
          onClick={onResetBaseline}
          className="shrink-0 rounded border border-neutral-800 px-1.5 py-0.5 hover:border-neutral-600 hover:text-neutral-300"
        >
          Reset
        </button>
      </div>

      <dl className="grid grid-cols-3 gap-3 text-xs">
        {[
          ['Storeys', String(structure.storeys.length)],
          ['Floor area', `${Math.round(floorArea_m2).toLocaleString('en-US')} m²`],
          ['Overturning', formatSafetyFactor(stability.factorOfSafetyOverturning)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-[0.65rem] uppercase tracking-wider text-neutral-600">
              {label}
            </dt>
            <dd className="tabular-nums text-neutral-300">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
