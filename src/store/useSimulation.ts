/**
 * Running the event.
 *
 * A three-phase state machine and a clock, and nothing else. It holds no
 * numbers about the building: what the simulation *shows* — which storeys
 * crack, which collapse, whether the thing stands — is `AnalysisResult.damage`,
 * which the engine produced from the same utilisations the table and the
 * dials are reading. This store decides only *when*.
 *
 * That division is the whole reason the simulation is allowed to exist. An
 * animation that decided outcomes would be the most dramatic thing on screen
 * and the least traceable, which is exactly what the project's one rule
 * forbids. So the animation may exaggerate motion, and says so on screen, but
 * it may not invent a collapse.
 *
 * Session state, deliberately unpersisted and outside the design store: a
 * reload should put a student back in the studio looking at their building,
 * not halfway through an earthquake.
 */

import { create } from 'zustand'
import type { Hazard } from '@/engine'

export type SimulationPhase =
  /** Not running. The studio behaves exactly as it always has. */
  | 'idle'
  /** A beat before it hits, so the student is looking at the building. */
  | 'bracing'
  /** The event. */
  | 'impact'
  /** What it left behind. Stays until dismissed. */
  | 'aftermath'

/** Long enough to look up from the panel, short enough not to be a wait. */
export const BRACE_MS = 1600
/**
 * Long enough for a gust to build, peak and pass — and for a student to watch
 * which storey goes first, which is the point of watching at all.
 */
export const IMPACT_MS = 5200

export interface SimulationState {
  phase: SimulationPhase
  /** `performance.now()` at the start of the current phase. */
  startedAt: number
  /**
   * The hazard the run was started for.
   *
   * Kept so that changing the hazard mid-run ends the run rather than morphing
   * an earthquake into a flood halfway through: the aftermath on screen has to
   * belong to the event that produced it.
   */
  hazardKind: Hazard['kind'] | null

  start: (hazardKind: Hazard['kind']) => void
  /** Back to the studio. Also what a changed hazard or design triggers. */
  dismiss: () => void
}

/**
 * Phase timers live at module scope rather than in the store, because they are
 * not state — nothing renders from them — and because a single handle makes
 * "cancel whatever was pending" one line in every path that ends a run.
 */
let pending: ReturnType<typeof setTimeout>[] = []

function clearPending(): void {
  for (const handle of pending) clearTimeout(handle)
  pending = []
}

export const useSimulationStore = create<SimulationState>()((set) => ({
  phase: 'idle',
  startedAt: 0,
  hazardKind: null,

  start: (hazardKind) => {
    clearPending()
    set({ phase: 'bracing', startedAt: performance.now(), hazardKind })
    pending.push(
      setTimeout(() => {
        set({ phase: 'impact', startedAt: performance.now() })
      }, BRACE_MS),
    )
    pending.push(
      setTimeout(() => {
        set({ phase: 'aftermath', startedAt: performance.now() })
      }, BRACE_MS + IMPACT_MS),
    )
  },

  dismiss: () => {
    clearPending()
    // A no-op when nothing is running, rather than a fresh object every time.
    // The viewport calls this on every change to the design, which is every
    // tick of every slider, and an unconditional `set` would notify every
    // subscriber of a state that had not changed.
    set((state) =>
      state.phase === 'idle'
        ? state
        : { phase: 'idle', startedAt: performance.now(), hazardKind: null },
    )
  },
}))

/** True while the studio should be showing an event rather than a design. */
export function isRunning(phase: SimulationPhase): boolean {
  return phase !== 'idle'
}
