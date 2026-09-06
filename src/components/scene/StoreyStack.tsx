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
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import {
  FACADE,
  MATERIAL_LIBRARY,
  type Storey,
  type StoreyResult,
  type Structure,
} from '@/engine'
import { BAND_HEX, utilizationBand } from '@/lib/palette.ts'
import { materialLook, wallColor } from '@/lib/materialLook.ts'
import { roofForm } from '@/lib/typology.ts'
import { gablePrism, monoPrism } from '@/lib/roofGeometry.ts'
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
  // A `get` rather than the engine's throwing `getMaterial`: by the time a
  // storey reaches the viewport `analyze` has already rejected an unknown
  // material, so this cannot normally miss — and if it somehow does, an
  // unadorned wall is a better failure than a black canvas. The default
  // uSurface of -1 draws no set-out at all, so nothing is invented here.
  const entry = MATERIAL_LIBRARY.get(storey.materialId)
  const look = entry ? materialLook(entry.structuralClass) : null
  // The band still decides which of three colours the storey is near; the
  // material only says which shade of it. An unknown material falls back to
  // the untinted band, which is the honest failure: no material claim at all.
  const colour = look ? wallColor(BAND_HEX[band], look.tint) : BAND_HEX[band]
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

/**
 * Neutral, like the foundation block above. Not a palette colour, on purpose.
 */
const ROOF_HEX = '#4b4a52'
/** Rise of a gable as a fraction of the span the slope climbs. */
const PITCH_RATIO = 0.3
/** However wide the building, a domestic roof does not become a spire. */
const PITCH_MAX_M = 4.5
/** Fall of a shed roof across its short span. About 5 degrees. */
const MONOPITCH_FALL = 0.09
const MONOPITCH_MAX_M = 3.5
const PARAPET_HEIGHT_M = 1.05
const PARAPET_THICKNESS_M = 0.35
/** The deck inside a parapet. Thin: it is a surface, not a storey. */
const DECK_THICKNESS_M = 0.16

/**
 * The roof, drawn from the design's declared typology.
 *
 * NEUTRAL BY RULE. The engine has no roof: it charges no carbon for one, gives
 * it no self-weight and puts no wind on it. So a roof must not wear a
 * utilisation colour, because in this scene a band colour is a claim about
 * safety and a roof has nothing to claim. Grey is how the viewport already
 * says "drawn, not analysed" — it is what `FoundationBlock` does, for exactly
 * the same reason.
 *
 * The parapet gets a deck for that reason too, and not only for looks: without
 * one you look down into the ring at the top face of the top storey, which is
 * painted the storey's utilisation colour. A green or red roof reads as a
 * safety claim about a roof the engine never analysed.
 *
 * KNOWN GAP, stated rather than buried: a real roof is real carbon and real
 * cost, and this one is neither. Closing that means a roof term in
 * `sustainability.ts` with a cited factor and its own tests — not a number
 * invented in a component.
 */
export function RoofCap({ structure }: { structure: Structure }) {
  const form = roofForm(structure.typology)
  const top = structure.storeys[structure.storeys.length - 1]
  const widthX_m = top?.widthX_m ?? 0
  const widthY_m = top?.widthY_m ?? 0

  // Seated on the *drawn* top face, not the nominal one. Each box is drawn
  // STOREY_GAP_M shorter than its storey and centred, so the stack really
  // stops half a gap below the sum of the heights. Using the sum floated every
  // roof 40 mm above its building.
  const wallTop_m =
    structure.storeys.reduce((total, storey) => total + storey.height_m, 0) -
    STOREY_GAP_M / 2

  const prism = useMemo(() => {
    if (form === 'pitched') {
      return gablePrism(widthX_m, widthY_m, PITCH_RATIO, PITCH_MAX_M)
    }
    if (form === 'monopitch') {
      return monoPrism(widthX_m, widthY_m, MONOPITCH_FALL, MONOPITCH_MAX_M)
    }
    return null
  }, [form, widthX_m, widthY_m])

  const geometry = useMemo(() => {
    if (prism === null) return null
    const built = new BufferGeometry()
    built.setAttribute(
      'position',
      new Float32BufferAttribute(Float32Array.from(prism.positions), 3),
    )
    // Per-face normals, so the ridge stays a crease instead of being smoothed
    // into a dome.
    built.computeVertexNormals()
    return built
  }, [prism])

  // Geometry built by hand is not disposed by r3f when the mesh unmounts.
  useEffect(() => {
    if (geometry === null) return
    return () => geometry.dispose()
  }, [geometry])

  if (form === 'flat' || top === undefined) return null

  if (prism !== null && geometry !== null) {
    return (
      <mesh
        castShadow
        receiveShadow
        geometry={geometry}
        position={[0, wallTop_m, 0]}
        rotation={[0, prism.rotationY, 0]}
      >
        <meshStandardMaterial color={ROOF_HEX} roughness={0.9} flatShading />
        <Edges color="#2f2748" />
      </mesh>
    )
  }

  // Parapet: a deck, with four upstands round its edge.
  const halfX = widthX_m / 2 - PARAPET_THICKNESS_M / 2
  const halfY = widthY_m / 2 - PARAPET_THICKNESS_M / 2
  const upstands: Array<{
    position: [number, number, number]
    size: [number, number, number]
  }> = [
    {
      position: [0, wallTop_m + PARAPET_HEIGHT_M / 2, -halfY],
      size: [widthX_m, PARAPET_HEIGHT_M, PARAPET_THICKNESS_M],
    },
    {
      position: [0, wallTop_m + PARAPET_HEIGHT_M / 2, halfY],
      size: [widthX_m, PARAPET_HEIGHT_M, PARAPET_THICKNESS_M],
    },
    {
      position: [-halfX, wallTop_m + PARAPET_HEIGHT_M / 2, 0],
      size: [PARAPET_THICKNESS_M, PARAPET_HEIGHT_M, widthY_m],
    },
    {
      position: [halfX, wallTop_m + PARAPET_HEIGHT_M / 2, 0],
      size: [PARAPET_THICKNESS_M, PARAPET_HEIGHT_M, widthY_m],
    },
  ]

  return (
    <group>
      <mesh
        receiveShadow
        position={[0, wallTop_m + DECK_THICKNESS_M / 2, 0]}
      >
        <boxGeometry args={[widthX_m, DECK_THICKNESS_M, widthY_m]} />
        <meshStandardMaterial color={ROOF_HEX} roughness={0.95} />
      </mesh>
      {upstands.map((wall, index) => (
        <mesh key={index} castShadow receiveShadow position={wall.position}>
          <boxGeometry args={wall.size} />
          <meshStandardMaterial color={ROOF_HEX} roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}
