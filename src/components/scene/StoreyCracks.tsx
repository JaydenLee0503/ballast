/**
 * Cracks on a damaged storey.
 *
 * The layout is `lib/cracks.ts` — seeded, pure, in normalised (u, v) space
 * around the perimeter — and this maps that space onto the storey's actual
 * surface, which is the one thing that has to know whether the plan is a
 * rectangle or an ellipse.
 *
 * It draws only what the engine already said. How many cracks a storey gets is
 * `CRACK_COUNT` keyed on its `DamageState`, and that state is banded from
 * `utilization` in `engine/damage.ts`. So a cracked storey on screen is a
 * storey the table shows over its limit, and there is no way for the two to
 * disagree.
 *
 * Lines rather than geometry: a crack is a line, `LineSegments` costs one draw
 * call for all of them, and nothing here needs to survive being looked at
 * closely — at the zoom a whole building is framed at, a dark line on a wall is
 * exactly what a crack looks like.
 */

import { useEffect, useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { DamageState, Storey } from '@/engine'
import { crackPolylines, CRACK_COUNT, type CrackPoint } from '@/lib/cracks.ts'

/** How far the lines sit proud of the wall, so they do not z-fight with it. */
const PROUD_M = 0.05

interface SurfacePoint {
  x: number
  y: number
  z: number
  /** Which face of a rectangular plan this is on; -1 for a continuous drum. */
  face: number
}

/**
 * (u, v) -> a point on this storey's wall.
 *
 * The rectangle walks the perimeter side by side and reports which side it
 * landed on, so a segment that would jump a corner can be dropped rather than
 * drawn as a chord through the building. The ellipse has no corners and no
 * sides, so it reports one continuous face — the same distinction
 * `windows.ts` makes when it sets panes out against the perimeter.
 */
function surfacePoint(
  storey: Storey,
  height_m: number,
  point: CrackPoint,
): SurfacePoint {
  const y = (point.v - 0.5) * height_m

  if (storey.planShape === 'ellipse') {
    const a = storey.widthX_m / 2
    const b = storey.widthY_m / 2
    const t = point.u * Math.PI * 2
    const cos = Math.cos(t)
    const sin = Math.sin(t)
    // Outward normal of an ellipse is (cos/a, sin/b), normalised.
    const nx = cos / a
    const nz = sin / b
    const length = Math.hypot(nx, nz) || 1
    return {
      x: a * cos + (nx / length) * PROUD_M,
      y,
      z: b * sin + (nz / length) * PROUD_M,
      face: -1,
    }
  }

  const X = storey.widthX_m
  const Z = storey.widthY_m
  const s = point.u * 2 * (X + Z)

  if (s < X) {
    return { x: -X / 2 + s, y, z: Z / 2 + PROUD_M, face: 0 }
  }
  if (s < X + Z) {
    return { x: X / 2 + PROUD_M, y, z: Z / 2 - (s - X), face: 1 }
  }
  if (s < 2 * X + Z) {
    return { x: X / 2 - (s - X - Z), y, z: -Z / 2 - PROUD_M, face: 2 }
  }
  return { x: -X / 2 - PROUD_M, y, z: -Z / 2 + (s - 2 * X - Z), face: 3 }
}

export interface StoreyCracksProps {
  storey: Storey
  /** The drawn height of the box, which is the storey minus the joint gap. */
  height_m: number
  damage: DamageState
  /** Seeds the layout, so the same storey cracks the same way every run. */
  index: number
}

export function StoreyCracks({
  storey,
  height_m,
  damage,
  index,
}: StoreyCracksProps) {
  const geometry = useMemo(() => {
    const count = CRACK_COUNT[damage] ?? 0
    if (count === 0) return null

    const positions: number[] = []
    for (const crack of crackPolylines(index + 1, count)) {
      for (let i = 0; i < crack.length - 1; i += 1) {
        const from = crack[i]
        const to = crack[i + 1]
        if (from === undefined || to === undefined) continue
        const a = surfacePoint(storey, height_m, from)
        const b = surfacePoint(storey, height_m, to)
        // A segment that wraps a corner of a rectangular plan would be drawn
        // as a chord straight through the building. Dropped instead.
        if (a.face !== b.face) continue
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
      }
    }
    if (positions.length === 0) return null

    const built = new BufferGeometry()
    built.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return built
  }, [storey, height_m, damage, index])

  // Built by hand, so r3f will not release it when the mesh unmounts.
  useEffect(() => {
    if (geometry === null) return
    return () => geometry.dispose()
  }, [geometry])

  if (geometry === null) return null

  return (
    <lineSegments geometry={geometry}>
      {/* Ink, the studio's own outline colour, rather than a utilisation red:
          the storey underneath is already wearing the colour that says how
          hard it is working, and a red line on a red wall says nothing. */}
      <lineBasicMaterial color="#231d36" transparent opacity={0.85} />
    </lineSegments>
  )
}
