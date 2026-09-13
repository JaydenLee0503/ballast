/**
 * The simulation clock, as a ref the scene can read every frame.
 *
 * The same pattern as `useNightProgress`: a value that changes on every frame
 * and that nothing renders from belongs in a ref, not in state. A React render
 * per frame would walk the whole scene tree — several hundred instanced
 * objects — to move one building.
 *
 * Phase and start time *are* state, because they change three times in a run
 * and the overlay does render from them. Turning those two into a position is
 * `motion.ts`, which is pure and testable; this hook is only the wiring.
 */

import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Hazard } from '@/engine'
import { useSimulationStore } from '@/store/useSimulation.ts'
import { motionAt, RESTING_MOTION, type SimulationMotion } from './motion.ts'

export function useSimulationMotion(
  hazardKind: Hazard['kind'],
): RefObject<SimulationMotion> {
  const phase = useSimulationStore((state) => state.phase)
  const startedAt = useSimulationStore((state) => state.startedAt)
  const motion = useRef<SimulationMotion>(RESTING_MOTION)

  useFrame(() => {
    motion.current = motionAt(
      phase,
      (performance.now() - startedAt) / 1000,
      hazardKind,
    )
  })

  return motion
}
