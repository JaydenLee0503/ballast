/**
 * What sits over the viewport while an event is running.
 *
 * Three states, matching the three phases: a countdown, a banner, and a report.
 * Every figure on the report is a field off `AnalysisResult` — the verdict and
 * the headline come from `engine/damage.ts`, the safety factor and the
 * governing mode from the same ScoreCard the dials are reading. Nothing here
 * decides an outcome, which is the whole reason the animation is allowed to be
 * dramatic: the drama is in the timing and the camera, never in the numbers.
 *
 * THE EXAGGERATION IS STATED, not implied. Real drift is millimetres and the
 * scene multiplies it so it can be seen, so the banner says by how much while
 * the building is moving. A simulation that silently scaled the lean would be
 * teaching a student that buildings visibly wobble in a breeze — which is
 * precisely the misconception the drift dial exists to correct.
 */

import { useEffect, useState } from 'react'
import type { AnalysisResult, Hazard, SurvivalVerdict } from '@/engine'
import { formatSafetyFactor } from '@/lib/format.ts'
import { HAZARD_HEX, HAZARD_LABEL, hazardSummary } from '@/lib/hazard.ts'
import { BAND_INK_HEX } from '@/lib/palette.ts'
import { MOTION_EXAGGERATION } from '@/components/scene/motion.ts'
import {
  BRACE_MS,
  useSimulationStore,
  type SimulationPhase,
} from '@/store/useSimulation.ts'

const VERDICT_LABEL: Readonly<Record<SurvivalVerdict, string>> = {
  stands: 'It stood',
  damaged: 'Damaged, still standing',
  failed: 'It failed',
}

const VERDICT_COLOUR: Readonly<Record<SurvivalVerdict, string>> = {
  stands: BAND_INK_HEX.safe,
  damaged: BAND_INK_HEX.caution,
  failed: BAND_INK_HEX.fail,
}

/**
 * The countdown, which is a clock and therefore state rather than a ref — it
 * ticks three times, not sixty times a second, and the number is rendered.
 */
function useCountdown(phase: SimulationPhase, startedAt: number): number {
  const [remaining, setRemaining] = useState(3)

  useEffect(() => {
    if (phase !== 'bracing') return
    const tick = () => {
      const left = BRACE_MS - (performance.now() - startedAt)
      setRemaining(Math.max(1, Math.ceil((left / BRACE_MS) * 3)))
    }
    tick()
    const handle = setInterval(tick, 120)
    return () => clearInterval(handle)
  }, [phase, startedAt])

  return remaining
}

/** The tally of how many storeys ended up in each state. Counting, not judging. */
function damageTally(result: AnalysisResult): string {
  const states = result.damage.storeys
  const collapsed = states.filter((state) => state === 'collapsed').length
  const severe = states.filter((state) => state === 'severe').length
  const cracked = states.filter((state) => state === 'cracked').length
  const parts: string[] = []
  if (collapsed > 0) parts.push(`${collapsed} collapsed`)
  if (severe > 0) parts.push(`${severe} badly damaged`)
  if (cracked > 0) parts.push(`${cracked} cracked`)
  if (parts.length === 0) return 'Every storey came through intact.'
  return `${parts.join(', ')} of ${states.length}.`
}

export interface SimulationOverlayProps {
  result: AnalysisResult
  hazard: Hazard
}

export function SimulationOverlay({ result, hazard }: SimulationOverlayProps) {
  const phase = useSimulationStore((state) => state.phase)
  const startedAt = useSimulationStore((state) => state.startedAt)
  const dismiss = useSimulationStore((state) => state.dismiss)
  const start = useSimulationStore((state) => state.start)
  const countdown = useCountdown(phase, startedAt)

  if (phase === 'idle') return null

  const label = HAZARD_LABEL[hazard.kind]
  const colour = HAZARD_HEX[hazard.kind]

  if (phase === 'bracing') {
    return (
      <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-3">
        <p
          className="rounded-full border-2 border-ink px-4 py-1.5 font-pixel text-sm tracking-widest text-ink shadow-[3px_3px_0_0_var(--color-ink)]"
          style={{ backgroundColor: colour }}
        >
          {label.toUpperCase()} INCOMING
        </p>
        <p
          className="font-display text-7xl tabular-nums text-ink drop-shadow-[3px_3px_0_rgba(255,247,239,0.9)]"
          aria-live="polite"
        >
          {countdown}
        </p>
        <p className="rounded-full border-2 border-ink/70 bg-paper/90 px-3 py-1 text-xs text-ink/70">
          Watch which storeys turn red first.
        </p>
      </div>
    )
  }

  if (phase === 'impact') {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-20 z-30 flex flex-col items-center gap-2">
        <p
          className="rounded-full border-2 border-ink px-4 py-1.5 font-pixel text-sm tracking-widest text-ink shadow-[3px_3px_0_0_var(--color-ink)]"
          style={{ backgroundColor: colour }}
        >
          {label.toUpperCase()} · {hazardSummary(hazard).toUpperCase()}
        </p>
        {/* The one sentence that keeps the animation honest. */}
        <p className="rounded-full border-2 border-ink/70 bg-paper/90 px-3 py-1 text-[0.7rem] text-ink/70">
          Movement shown {MOTION_EXAGGERATION}× life size · the numbers are not
          exaggerated
        </p>
      </div>
    )
  }

  const { verdict, headline } = result.damage

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-6">
      <div className="sticker pointer-events-auto w-full max-w-sm space-y-3 p-5">
        <div>
          <p className="font-pixel text-[0.7rem] tracking-widest text-ink/45">
            AFTER THE {label.toUpperCase()}
          </p>
          <h2
            className="font-display text-2xl"
            style={{ color: VERDICT_COLOUR[verdict] }}
          >
            {VERDICT_LABEL[verdict]}
          </h2>
        </div>

        {/* Straight from `engine/damage.ts` — it names the governing mode the
            ScoreCard already chose, and adds nothing to it. */}
        <p className="text-sm leading-relaxed text-ink/75">{headline}</p>
        <p className="text-xs leading-relaxed text-ink/60">
          {damageTally(result)}
        </p>

        <dl className="slab grid grid-cols-2 gap-3 p-3 text-xs">
          <div>
            <dt className="font-pixel text-[0.65rem] uppercase tracking-widest text-ink/45">
              Safety factor
            </dt>
            <dd className="mt-0.5 font-display tabular-nums text-ink">
              {formatSafetyFactor(result.scoreCard.safetyFactor)}
            </dd>
          </div>
          <div>
            <dt className="font-pixel text-[0.65rem] uppercase tracking-widest text-ink/45">
              Base load
            </dt>
            <dd className="mt-0.5 font-display tabular-nums text-ink">
              {result.stability.baseShear_kN.toFixed(0)} kN
            </dd>
          </div>
        </dl>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="flex-1 rounded-full border-2 border-ink bg-white py-2 font-display text-sm shadow-[3px_3px_0_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
          >
            Back to the building
          </button>
          <button
            type="button"
            onClick={() => start(hazard.kind)}
            className="rounded-full border-2 border-ink/15 bg-white px-3 py-2 font-display text-sm text-ink/60 hover:border-ink hover:text-ink"
          >
            Again
          </button>
        </div>

        <p className="text-[0.65rem] leading-relaxed text-ink/45">
          Every storey that cracked is one the engine puts over its limit — the
          same reading the table and the dials show. Go and change something.
        </p>
      </div>
    </div>
  )
}
