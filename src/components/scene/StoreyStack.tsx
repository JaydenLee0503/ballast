/**
 * The building itself: one box per storey, coloured by utilisation.
 *
 * COORDINATE MAPPING. The engine works in plan X/Y with height as a separate
 * field; three.js is Y-up. So:
 *     engine widthX_m -> three X
 *     engine widthY_m -> three Z
 *     engine height_m -> three Y
 * Every place that converts between the two says so. Get this wrong and the
 * building looks fine but the wind arrives on the wrong face.
 *
 * One box per storey is a deliberate ceiling on fidelity. The engine models a
 * storey as a gross volume times a structural fraction — it has no columns,
 * no beams and no core — so drawing a frame would promise resolution the
 * physics does not have.
 */

import { Edges } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { StoreyResult, Structure } from '@/engine'
import { BAND_HEX, utilizationBand } from '@/lib/palette.ts'

/** Vertical gap between boxes, so the edge lines read as separate storeys. */
const STOREY_GAP_M = 0.08

export interface StoreyStackProps {
  structure: Structure
  storeys: readonly StoreyResult[]
  selectedStoreyIndex: number | null
  onSelect: (index: number | null) => void
}

export function StoreyStack({
  structure,
  storeys,
  selectedStoreyIndex,
  onSelect,
}: StoreyStackProps) {
  // Pair geometry with results by index. flatMap over a possibly-short results
  // array rather than indexing with `!`, so a mismatch renders less rather
  // than crashing.
  const items = structure.storeys.flatMap((storey, index) => {
    const result = storeys[index]
    return result ? [{ storey, result, index }] : []
  })

  return (
    <group>
      {items.map(({ storey, result, index }) => {
        const band = utilizationBand(result.utilization)
        const selected = selectedStoreyIndex === index
        const boxHeight = Math.max(0.1, storey.height_m - STOREY_GAP_M)

        return (
          <mesh
            key={index}
            castShadow
            receiveShadow
            position={[0, result.baseElevation_m + storey.height_m / 2, 0]}
            onClick={(event: ThreeEvent<MouseEvent>) => {
              // Without this the click passes through to every storey behind.
              event.stopPropagation()
              onSelect(selected ? null : index)
            }}
            onPointerOver={(event: ThreeEvent<PointerEvent>) => {
              event.stopPropagation()
              document.body.style.cursor = 'pointer'
            }}
            onPointerOut={() => {
              document.body.style.cursor = ''
            }}
          >
            <boxGeometry args={[storey.widthX_m, boxHeight, storey.widthY_m]} />
            <meshStandardMaterial
              color={BAND_HEX[band]}
              roughness={0.55}
              metalness={0.05}
              emissive={BAND_HEX[band]}
              emissiveIntensity={selected ? 0.45 : 0.05}
            />
            <Edges color={selected ? '#ffffff' : '#0c0a09'} />
          </mesh>
        )
      })}
    </group>
  )
}

/**
 * The buried part of the foundation, drawn so the embedment-depth control has
 * something visible to move. Passive soil resistance in stability.ts scales
 * with the square of this depth, which is otherwise invisible.
 */
export function FoundationBlock({ structure }: { structure: Structure }) {
  const ground = structure.storeys[0]
  if (!ground) return null
  const depth = structure.foundation.embedmentDepth_m
  if (depth <= 0) return null

  return (
    <mesh position={[0, -depth / 2, 0]} receiveShadow>
      <boxGeometry args={[ground.widthX_m, depth, ground.widthY_m]} />
      <meshStandardMaterial color="#44403c" roughness={0.95} />
      <Edges color="#1c1917" />
    </mesh>
  )
}
