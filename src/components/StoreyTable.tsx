/**
 * The per-storey breakdown. Rows select the storey they describe, so the
 * table and the 3D view are two views of one selection.
 *
 * Utilisation is max(drift, strength) per storey — the same number that
 * colours the box in the viewport, read from the same StoreyResult.
 */

import type { AnalysisResult } from '@/engine'
import { formatDriftRatio, formatPercent } from '@/lib/format.ts'
import { BAND_TEXT_CLASS, utilizationBand } from '@/lib/palette.ts'

export interface StoreyTableProps {
  result: AnalysisResult
  selectedStoreyIndex: number | null
  onSelect: (index: number | null) => void
}

const COLUMNS = ['Storey', 'Force', 'Shear', 'Drift', 'Util.'] as const

export function StoreyTable({
  result,
  selectedStoreyIndex,
  onSelect,
}: StoreyTableProps) {
  return (
    <div className="slab overflow-hidden">
      <table className="w-full text-xs tabular-nums">
        <thead className="bg-ink/5 text-left font-pixel text-[0.65rem] uppercase tracking-widest text-ink/50">
          <tr>
            {COLUMNS.map((heading) => (
              <th key={heading} className="px-2 py-1.5 font-normal">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Reversed so the roof is at the top of the table, matching the
              building. storeys[0] is the ground storey. */}
          {[...result.storeys].reverse().map((storey) => {
            const band = utilizationBand(storey.utilization)
            const selected = selectedStoreyIndex === storey.index

            return (
              <tr
                key={storey.index}
                onClick={() => onSelect(selected ? null : storey.index)}
                className={`cursor-pointer border-t-2 border-ink/10 ${
                  selected ? 'bg-lilac/25' : 'hover:bg-ink/5'
                }`}
              >
                <td className="px-2 py-1 font-display text-ink">
                  {storey.index + 1}
                </td>
                <td className="px-2 py-1 text-ink/75">
                  {storey.lateralForce_kN.toFixed(1)} kN
                </td>
                <td className="px-2 py-1 text-ink/75">
                  {storey.storeyShear_kN.toFixed(0)} kN
                </td>
                <td className="px-2 py-1 text-ink/75">
                  {formatDriftRatio(storey.driftRatio)}
                </td>
                <td className={`px-2 py-1 font-bold ${BAND_TEXT_CLASS[band]}`}>
                  {formatPercent(storey.utilization)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
