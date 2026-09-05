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
    <table className="w-full text-xs tabular-nums">
      <thead className="text-left text-[0.65rem] uppercase tracking-wider text-neutral-600">
        <tr>
          {COLUMNS.map((heading) => (
            <th key={heading} className="pb-1 pr-2 font-medium">
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
              className={`cursor-pointer border-t border-neutral-900 ${
                selected ? 'bg-neutral-800/60' : 'hover:bg-neutral-900/60'
              }`}
            >
              <td className="py-1 pr-2 text-neutral-400">{storey.index + 1}</td>
              <td className="py-1 pr-2 text-neutral-300">
                {storey.lateralForce_kN.toFixed(1)} kN
              </td>
              <td className="py-1 pr-2 text-neutral-300">
                {storey.storeyShear_kN.toFixed(0)} kN
              </td>
              <td className="py-1 pr-2 text-neutral-300">
                {formatDriftRatio(storey.driftRatio)}
              </td>
              <td className={`py-1 pr-2 font-medium ${BAND_TEXT_CLASS[band]}`}>
                {formatPercent(storey.utilization)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
