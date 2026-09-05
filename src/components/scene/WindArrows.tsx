/**
 * Wind, drawn from engine output.
 *
 * One arrow per storey, positioned upwind at that storey's mid-height, with
 * length proportional to `StoreyResult.lateralForce_kN`. This is not
 * decoration: it is the Kz profile and the projected-area term made visible.
 * Arrows get longer up the building because velocity pressure grows with
 * height, and the whole fan gets longer or shorter as the plan is rotated
 * into or out of the wind. A student can see the load case before they can
 * read the table.
 *
 * Lengths are normalised against the largest storey force, so the picture
 * shows the *shape* of the load, not its magnitude. Magnitude is the panel's
 * job — a bar chart that silently rescales is a bad way to show a number.
 */

import type { StoreyResult, WindHazard } from '@/engine'
import { WIND_HEX } from '@/lib/palette.ts'

const MIN_ARROW_M = 2
const MAX_ARROW_M = 10
/** Clearance between the arrow tip and the building face. */
const STANDOFF_M = 2.5

export interface WindArrowsProps {
  storeys: readonly StoreyResult[]
  hazard: WindHazard
  /** Half-diagonal of the plan, used to keep arrows clear of any rotation. */
  footprintRadius_m: number
}

export function WindArrows({
  storeys,
  hazard,
  footprintRadius_m,
}: WindArrowsProps) {
  const maxForce_kN = storeys.reduce(
    (max, storey) => Math.max(max, storey.lateralForce_kN),
    0,
  )
  // Still air: no load, so nothing to draw. Avoids a divide by zero below.
  if (maxForce_kN <= 0) return null

  // directionDeg is the direction the wind blows *towards*, measured in the
  // engine's plan frame: 0 = along +X, 90 = along +Y. In three's frame that
  // is (cos, 0, sin) — engine Y is three Z.
  const radians = (hazard.directionDeg * Math.PI) / 180
  const dirX = Math.cos(radians)
  const dirZ = Math.sin(radians)

  return (
    <group>
      {storeys.map((storey) => {
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
            position={[-dirX * tail, storey.midHeight_m, -dirZ * tail]}
            // The arrow is modelled along its local +Y. Euler order is XYZ, so
            // this applies Rz(-90) first (+Y -> +X), then Ry(-theta), which
            // takes +X to (cos, 0, sin). See the direction note above.
            rotation={[0, -radians, -Math.PI / 2]}
          >
            <mesh position={[0, shaft / 2, 0]}>
              <cylinderGeometry args={[0.11, 0.11, shaft, 10]} />
              <meshStandardMaterial
                color={WIND_HEX}
                emissive={WIND_HEX}
                emissiveIntensity={0.4}
                roughness={0.4}
              />
            </mesh>
            <mesh position={[0, shaft + head / 2, 0]}>
              <coneGeometry args={[0.34, head, 14]} />
              <meshStandardMaterial
                color={WIND_HEX}
                emissive={WIND_HEX}
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
