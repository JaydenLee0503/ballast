/**
 * The eased time of day, shared by everything that has to agree about it.
 *
 * Owned above both the sky and the building rather than inside the sky,
 * because the student's own windows light up on the same schedule as the
 * neighbourhood's and the two must not be allowed to drift apart.
 *
 * Eased, so that adding a storey slides the light along rather than cutting to
 * a new time of day, and seeded at the target so the very first frame is
 * already right rather than dawn.
 *
 * A ref, not state: it changes every frame and nothing renders from it.
 */

import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { nightProgress } from '@/lib/sky.ts'

/** Per second, exponential. Roughly half a second to cover most of a change. */
const SKY_EASE_RATE = 2.2

export function useNightProgress(totalHeight_m: number): RefObject<number> {
  const night = useRef(nightProgress(totalHeight_m))
  useFrame((_, delta) => {
    const target = nightProgress(totalHeight_m)
    night.current += (target - night.current) * (1 - Math.exp(-delta * SKY_EASE_RATE))
  })
  return night
}
