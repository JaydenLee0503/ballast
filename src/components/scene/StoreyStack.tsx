/**
 * The building itself: one box per storey, coloured by utilisation and glazed
 * by its facade.
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
 *
 * The windows are the exception, and they are not decoration: a storey's
 * window-to-wall ratio is a field of `Storey`, the engine charges carbon,
 * money and weight for it, and the panes on screen cover exactly that
 * fraction of the wall. Choosing a curtain wall makes the building glassier
 * *and* lighter *and* more expensive, and the picture is the honest one.
 *
 * Utilisation still owns the colour. Panes are a tint of the band colour
 * rather than a colour of their own, so a red storey with a lot of glass is
 * still unmistakably a red storey — the safety readout is not something the
 * facade control gets to interfere with.
 *
 * The material shows itself the same way, and for the same reason: as a
 * finish, never as a hue. A steel storey is glossier and set out in vertical
 * bays, a rammed-earth one is dead matte and lifts in horizontal courses, and
 * both are still exactly the green, amber or red their utilisation earned.
 * See `lib/materialLook.ts`.
 */

import { useEffect, useMemo, type RefObject } from 'react'
import { Edges } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import {
  FACADE,
  MATERIAL_LIBRARY,
  type Storey,
  type StoreyResult,
  type Structure,
} from '@/engine'
import { BAND_HEX, utilizationBand } from '@/lib/palette.ts'
import { materialLook } from '@/lib/materialLook.ts'
import { createWindowedMaterial } from './windows.ts'

/** Vertical gap between boxes, so the edge lines read as separate storeys. */
const STOREY_GAP_M = 0.08

/**
 * Window bay for the student's own building. Roughly a domestic window pitch,
 * so a 12 m elevation reads as four bays rather than as an abstraction — see
 * `windows.ts` for how a face turns this into whole panes.
 */
const BAY_WIDTH_M = 3.2
const BAY_HEIGHT_M = 3.6
/** Rather more of the lights on than the neighbourhood: this one is occupied. */
const LIT_FRACTION = 0.55

interface StoreyBoxProps {
  storey: Storey
  result: StoreyResult
  index: number
  selected: boolean
  hovered: boolean
  /** Eased 0..1 time of day, shared with the sky. Lights the panes. */
  night: RefObject<number>
  onSelect: (index: number | null) => void
  onHover: (index: number, clientX: number, clientY: number) => void
  onHoverEnd: (index: number) => void
}

function StoreyBox({
  storey,
  result,
  index,
  selected,
  hovered,
  night,
  onSelect,
  onHover,
  onHoverEnd,
}: StoreyBoxProps) {
  // One material per storey, because each carries its own band colour, its own
  // glazing ratio and its own size. Built once and mutated, rather than
  // rebuilt per render: a new material is a new shader program compile.
  const windowed = useMemo(
    () =>
      createWindowedMaterial(
        { roughness: 0.55, metalness: 0.05 },
        {
          instanced: false,
          bayWidth_m: BAY_WIDTH_M,
          bayHeight_m: BAY_HEIGHT_M,
          litFraction: LIT_FRACTION,
        },
      ),
    [],
  )
  useEffect(() => () => windowed.dispose(), [windowed])

  const band = utilizationBand(result.utilization)
  const colour = BAND_HEX[band]
  // A `get` rather than the engine's throwing `getMaterial`: by the time a
  // storey reaches the viewport `analyze` has already rejected an unknown
  // material, so this cannot normally miss — and if it somehow does, an
  // unadorned wall is a better failure than a black canvas. The default
  // uSurface of -1 draws no set-out at all, so nothing is invented here.
  const entry = MATERIAL_LIBRARY.get(storey.materialId)
  const look = entry ? materialLook(entry.structuralClass) : null
  const boxHeight = Math.max(0.1, storey.height_m - STOREY_GAP_M)
  const windowToWallRatio = FACADE[storey.facade].windowToWallRatio

  useEffect(() => {
    // Selection is the loud state and hover the quiet one, so that pointing at
    // a storey never looks like having picked it.
    windowed.setAppearance(colour, selected ? 0.45 : hovered ? 0.22 : 0.05)
  }, [windowed, colour, selected, hovered])

  useEffect(() => {
    if (look) windowed.setFinish(look)
  }, [windowed, look])

  useEffect(() => {
    windowed.setWindowToWallRatio(windowToWallRatio)
    // The shader lays panes out against the real face sizes, so it has to be
    // told them; the geometry knows, but the vertex shader only sees corners.
    windowed.setSize(storey.widthX_m, boxHeight, storey.widthY_m)
  }, [windowed, windowToWallRatio, storey.widthX_m, storey.widthY_m, boxHeight])

  // The one per-frame value: the panes come on as the sky goes down.
  useFrame(() => windowed.setNight(night.current))

  return (
    <mesh
      castShadow
      receiveShadow
      material={windowed.material}
      position={[0, result.baseElevation_m + storey.height_m / 2, 0]}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        // Without this the click passes through to every storey behind.
        event.stopPropagation()
        onSelect(selected ? null : index)
      }}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation()
        document.body.style.cursor = 'pointer'
        onHover(index, event.nativeEvent.clientX, event.nativeEvent.clientY)
      }}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation()
        onHover(index, event.nativeEvent.clientX, event.nativeEvent.clientY)
      }}
      onPointerOut={() => {
        document.body.style.cursor = ''
        onHoverEnd(index)
      }}
    >
      <boxGeometry args={[storey.widthX_m, boxHeight, storey.widthY_m]} />
      {/* Ink by default, the studio's own outline colour; paper on hover;
          white on selection. */}
      <Edges color={selected ? '#ffffff' : hovered ? '#fff7ef' : '#2f2748'} />
    </mesh>
  )
}

export interface StoreyStackProps {
  structure: Structure
  storeys: readonly StoreyResult[]
  selectedStoreyIndex: number | null
  onSelect: (index: number | null) => void
  hoveredStoreyIndex: number | null
  night: RefObject<number>
  /**
   * Called on entering a storey and on every move across it, with the pointer
   * in client coordinates. The caller decides what to do with the position;
   * `Viewport` writes it straight to the DOM so following the pointer costs no
   * React renders.
   */
  onHover: (index: number, clientX: number, clientY: number) => void
  /**
   * The pointer left this storey. Takes the index rather than nothing, because
   * moving between two adjacent storeys fires an exit and an entry with no
   * ordering guarantee worth relying on — the caller can then clear only if
   * the storey leaving is still the one it thinks is hovered.
   */
  onHoverEnd: (index: number) => void
}

export function StoreyStack({
  structure,
  storeys,
  selectedStoreyIndex,
  onSelect,
  hoveredStoreyIndex,
  night,
  onHover,
  onHoverEnd,
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
      {items.map(({ storey, result, index }) => (
        <StoreyBox
          key={index}
          storey={storey}
          result={result}
          index={index}
          selected={selectedStoreyIndex === index}
          hovered={hoveredStoreyIndex === index}
          night={night}
          onSelect={onSelect}
          onHover={onHover}
          onHoverEnd={onHoverEnd}
        />
      ))}
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
