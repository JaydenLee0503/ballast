/**
 * The load, drawn from engine output.
 *
 * One arrow per storey, at that storey's own load elevation, with length
 * proportional to `StoreyResult.lateralForce_kN`. This is not decoration: it is
 * the load case made visible, and the three hazards draw three unmistakably
 * different pictures from the same code.
 *
 *   wind     arrows grow upward, because velocity pressure grows with height.
 *   seismic  arrows follow weight times height, so they grow upward too but
 *            for a different reason — and a heavy storey anywhere in the stack
 *            is a long arrow wherever it sits.
 *   flood    arrows exist only below the water line, low and enormous, and
 *            nothing at all above it. The first time a student switches a tower
 *            from a storm to a flood, the fan of arrows drops to its ankles.
 *
 * Lengths are normalised against the largest storey force, so the picture shows
 * the *shape* of the load, not its magnitude. Magnitude is the panel's job — a
 * bar chart that silently rescales is a bad way to show a number.
 *
 * Colour comes from `lib/hazard.ts`, never from `lib/palette.ts`: green, amber
 * and red mean "how hard is this storey working", and an arrow has nothing to
 * say about that.
 */

import type { Hazard, StoreyResult } from '@/engine'
import { HAZARD_HEX } from '@/lib/hazard.ts'

const MIN_ARROW_M = 2
const MAX_ARROW_M = 10
/** Clearance between the arrow tip and the building face. */
const STANDOFF_M = 2.5

export interface HazardArrowsProps {
  storeys: readonly StoreyResult[]
  hazard: Hazard
  /** Half-diagonal of the plan, used to keep arrows clear of any rotation. */
  footprintRadius_m: number
}

export function HazardArrows({
  storeys,
  hazard,
  footprintRadius_m,
}: HazardArrowsProps) {
  const maxForce_kN = storeys.reduce(
    (max, storey) => Math.max(max, storey.lateralForce_kN),
    0,
  )
  // No load, so nothing to draw — still air, no earthquake, or no water. Also
  // avoids a divide by zero below.
  if (maxForce_kN <= 0) return null

  const colour = HAZARD_HEX[hazard.kind]

  // directionDeg is the direction the load acts *towards*, measured in the
  // engine's plan frame: 0 = along +X, 90 = along +Y. In three's frame that
  // is (cos, 0, sin) — engine Y is three Z.
  const radians = (hazard.directionDeg * Math.PI) / 180
  const dirX = Math.cos(radians)
  const dirZ = Math.sin(radians)

  return (
    <group>
      {storeys.map((storey) => {
        // A storey above the flood line carries nothing, and a zero-length
        // arrow at the minimum length would claim otherwise.
        if (storey.lateralForce_kN <= 0) return null

        const length =
          MIN_ARROW_M +
          (MAX_ARROW_M - MIN_ARROW_M) * (storey.lateralForce_kN / maxForce_kN)
        // Tail sits a full arrow-length plus the standoff upwind of the plan,
        // so the head stops just short of the face it is pushing on.
        const tail = footprintRadius_m + STANDOFF_M + length
        const shaft = length * 0.72
        const head = length * 0.28

        return (
          <group
            key={storey.index}
            // At the elevation the engine says the resultant acts, which for a
            // flood is the centroid of the submerged part rather than the
            // storey's middle. The arrow and the moment arm agree by
            // construction.
            position={[-dirX * tail, storey.loadElevation_m, -dirZ * tail]}
            // The arrow is modelled along its local +Y. Euler order is XYZ, so
            // this applies Rz(-90) first (+Y -> +X), then Ry(-theta), which
            // takes +X to (cos, 0, sin). See the direction note above.
            rotation={[0, -radians, -Math.PI / 2]}
          >
            <mesh position={[0, shaft / 2, 0]}>
              <cylinderGeometry args={[0.11, 0.11, shaft, 10]} />
              <meshStandardMaterial
                color={colour}
                emissive={colour}
                emissiveIntensity={0.4}
                roughness={0.4}
              />
            </mesh>
            <mesh position={[0, shaft + head / 2, 0]}>
              <coneGeometry args={[0.34, head, 14]} />
              <meshStandardMaterial
                color={colour}
                emissive={colour}
                emissiveIntensity={0.4}
                roughness={0.4}
              />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}
