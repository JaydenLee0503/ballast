/**
 * Placeholder shell. The 3D viewport, AI critique panel and Supabase auth all
 * land in later sessions; this exists only to prove the engine is wired into
 * the app and to give the numbers somewhere to show up.
 */
import { useMemo, useState } from 'react'
import {
  analyze,
  MATERIAL_LIBRARY,
  type Structure,
  type WindHazard,
} from './engine/index.ts'

const DEMO_STRUCTURE: Structure = {
  storeys: Array.from({ length: 6 }, () => ({
    height_m: 3.5,
    widthX_m: 18,
    widthY_m: 12,
    materialId: 'cross-laminated-timber',
    lateralSystem: 'shear-wall' as const,
  })),
  foundation: { type: 'raft', embedmentDepth_m: 1.5, anchorCapacity_kN: 600 },
  exposureCategory: 'C',
}

function utilizationColor(utilization: number): string {
  if (utilization > 1) return 'text-fail'
  if (utilization > 0.7) return 'text-caution'
  return 'text-safe'
}

export default function App() {
  const [gustSpeed_kmh, setGustSpeed] = useState(150)

  const result = useMemo(() => {
    const hazard: WindHazard = {
      kind: 'wind',
      gustSpeed_kmh,
      directionDeg: 0,
      terrainRoughness: 0.02,
    }
    return analyze(DEMO_STRUCTURE, hazard, MATERIAL_LIBRARY)
  }, [gustSpeed_kmh])
  const { scoreCard, stability } = result

  return (
    <main className="min-h-screen bg-neutral-950 p-8 font-sans text-neutral-100">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">Resilience Studio</h1>
        <p className="text-sm text-neutral-400">
          Engine harness. 6-storey CLT shear-wall block, 18 x 12 m plan,
          Exposure C.
        </p>
      </header>

      <label className="mb-8 block max-w-md">
        <span className="text-sm text-neutral-300">
          Gust speed: {gustSpeed_kmh} km/h
        </span>
        <input
          type="range"
          min={0}
          max={300}
          step={5}
          value={gustSpeed_kmh}
          onChange={(e) => setGustSpeed(Number(e.target.value))}
          className="mt-2 w-full"
        />
      </label>

      <section className="mb-8 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ['Safety factor', scoreCard.safetyFactor.toFixed(2)],
          ['Carbon', `${(scoreCard.carbonKg / 1000).toFixed(1)} t CO2e`],
          ['Cost', `$${(scoreCard.costUsd / 1000).toFixed(0)}k`],
          ['Worst drift', `h/${Math.round(1 / scoreCard.driftRatio)}`],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-neutral-800 p-3">
            <div className="text-xs uppercase tracking-wide text-neutral-500">
              {label}
            </div>
            <div className="mt-1 text-lg tabular-nums">{value}</div>
          </div>
        ))}
      </section>

      <p className="mb-8 text-sm">
        Governing failure mode:{' '}
        <strong
          className={
            scoreCard.governingFailureMode === 'none' ? 'text-safe' : 'text-fail'
          }
        >
          {scoreCard.governingFailureMode}
        </strong>
        <span className="ml-4 text-neutral-400">
          base shear {stability.baseShear_kN.toFixed(1)} kN
        </span>
      </p>

      <table className="max-w-3xl text-sm tabular-nums">
        <thead className="text-left text-xs uppercase text-neutral-500">
          <tr>
            {['Storey', 'Force kN', 'Shear kN', 'Drift', 'Utilisation'].map((h) => (
              <th key={h} className="py-1 pr-6 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...result.storeys].reverse().map((s) => (
            <tr key={s.index} className="border-t border-neutral-900">
              <td className="py-1 pr-6">{s.index + 1}</td>
              <td className="py-1 pr-6">{s.lateralForce_kN.toFixed(1)}</td>
              <td className="py-1 pr-6">{s.storeyShear_kN.toFixed(1)}</td>
              <td className="py-1 pr-6">h/{Math.round(1 / s.driftRatio)}</td>
              <td className={`py-1 pr-6 ${utilizationColor(s.utilization)}`}>
                {(s.utilization * 100).toFixed(0)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {result.warnings.length > 0 && (
        <ul className="mt-8 max-w-3xl space-y-2 text-xs text-caution">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </main>
  )
}
