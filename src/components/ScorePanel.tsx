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
 */

import {
  DRIFT_LIMIT_RATIO,
  TARGET_SAFETY_FACTOR,
  grossFloorArea_m2,
  type AnalysisResult,
  type FailureMode,
  type Structure,
} from '@/engine'
import {
  formatCarbon,
  formatDriftRatio,
  formatSafetyFactor,
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

function Dial({
  label,
  value,
  sub,
  utilization,
  note,
}: {
  label: string
  value: string
  sub: string
  /** Dimensionless demand/capacity, 1.0 = at the limit. Drives the bar. */
  utilization: number
  note?: string
}) {
  const band = utilizationBand(utilization)
  const fill = Math.max(0, Math.min(1, utilization))

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="text-[0.65rem] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-xl tabular-nums text-neutral-100">{value}</div>
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
}

export function ScorePanel({ result, structure }: ScorePanelProps) {
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
        />
        <Dial
          label="Worst drift"
          value={formatDriftRatio(scoreCard.driftRatio)}
          sub={`limit ${formatDriftRatio(DRIFT_LIMIT_RATIO)}`}
          utilization={driftUtilization}
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
        />
        <Dial
          label="Cost"
          value={formatUsd(scoreCard.costUsd)}
          sub={`${formatUsd(costIntensity)}/m²`}
          // Same idea: $400/m2 of frame as the yardstick.
          utilization={costIntensity / 400}
          note="indicative rates"
        />
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
