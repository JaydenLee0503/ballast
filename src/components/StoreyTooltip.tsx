/**
 * What a block is, when you point at it.
 *
 * The 3D view colours storeys and the table explains them, and between those
 * two there was a gap: a student looking at the red box near the ground had to
 * find the matching row before they learned anything about it. This closes
 * that gap without a click.
 *
 * Deliberately a handful of lines. It is a glance, not a panel — the storey
 * table two inches to the right already carries the full breakdown, and a
 * hover card that tried to repeat it would be unreadable at the speed people
 * move a mouse. What is here is what answers "why is this one red": how hard
 * it is working, how much wind is on it, how far it leans, and the two choices
 * that put it there — what it is made of and what it is wrapped in.
 *
 * Every figure is a field off `StoreyResult` or `Storey`, formatted by
 * `lib/format.ts`. Nothing here computes anything; the percentage in the pill
 * is the same `utilization` that picked the colour of the box under the
 * cursor, so the two cannot disagree.
 *
 * Positioning is the caller's job — `Viewport` writes it straight to the DOM
 * so that following the pointer costs no React renders.
 */

import { MATERIAL_LIBRARY, type AnalysisResult, type Structure } from '@/engine'
import { FACADE_LABEL } from '@/lib/facade.ts'
import { formatDriftRatio, formatPercent } from '@/lib/format.ts'
import { BAND_HEX, BAND_INK_HEX, BAND_LABEL, utilizationBand } from '@/lib/palette.ts'

export interface StoreyTooltipProps {
  result: AnalysisResult
  structure: Structure
  /** Index into `result.storeys`, or null when nothing is hovered. */
  index: number | null
}

export function StoreyTooltip({ result, structure, index }: StoreyTooltipProps) {
  const storeyResult = index === null ? undefined : result.storeys[index]
  const storey = index === null ? undefined : structure.storeys[index]
  if (storeyResult === undefined || storey === undefined) return null

  const band = utilizationBand(storeyResult.utilization)
  const material = MATERIAL_LIBRARY.get(storey.materialId)

  return (
    <div className="sticker w-56 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-sm text-ink">
          Storey {storeyResult.index + 1}
        </span>
        <span
          className="shrink-0 rounded-full border-2 px-1.5 py-px text-[0.6rem] font-bold"
          style={{
            borderColor: BAND_INK_HEX[band],
            color: BAND_INK_HEX[band],
            backgroundColor: `${BAND_HEX[band]}22`,
          }}
        >
          {BAND_LABEL[band]}
        </span>
      </div>

      {/* The bar is the same shape and the same raw band hex as the dials, so
          a glance here and a glance at the panel mean the same thing. */}
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full border-2 border-ink bg-paper">
        <div
          className="h-full"
          style={{
            width: `${Math.max(0, Math.min(1, storeyResult.utilization)) * 100}%`,
            backgroundColor: BAND_HEX[band],
          }}
        />
      </div>

      <dl className="mt-2 space-y-0.5 text-[0.7rem]">
        {[
          ['Working at', formatPercent(storeyResult.utilization)],
          ['Wind on it', `${storeyResult.lateralForce_kN.toFixed(1)} kN`],
          ['Lean', formatDriftRatio(storeyResult.driftRatio)],
          // A material can be missing only if a design outran the library,
          // which the parser refuses -- but the id is more useful than a crash.
          ['Made of', material?.name ?? storey.materialId],
          ['Wrapped in', FACADE_LABEL[storey.facade]],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="shrink-0 text-ink/50">{label}</dt>
            <dd className="truncate text-right tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
