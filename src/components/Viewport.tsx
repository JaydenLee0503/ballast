/**
 * The 3D view: the design, standing on a plot, in a city.
 *
 * Two layers, and the line between them is the point. The **design** —
 * `StoreyStack` and `HazardArrows` — renders `AnalysisResult` and nothing more:
 * every colour and every arrow length traces to a field the engine produced,
 * and those are the only saturated colours in the frame. The **world** —
 * `scene/World.tsx` — is scenery: streets, trees, traffic, neighbours and a
 * sky that darkens as the tower climbs. It reads no engine output and feeds
 * none; its only input is the design's total height, which is something the
 * student typed, not something the engine derived.
 *
 * The scenery earns its place by supplying scale. A 40 m tower means nothing
 * beside an empty grid and a great deal beside four-storey walk-ups and a road
 * with cars on it, and a building that is about to fall over is a different
 * proposition when there is a street underneath.
 *
 * Lighting and sky are entirely local. No `<Environment>`, no drei `<Text>`,
 * no textures — all of those fetch assets from a CDN at runtime, which would
 * make the viewport depend on the network and on a third party staying up
 * during a demo.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentRef,
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Vector2, Vector3 } from 'three'
import type { AnalysisResult, Structure, Hazard } from '@/engine'
import { rotateAboutPivot } from '@/lib/orbit.ts'
import { BAND_HEX, BAND_LABEL, type UtilizationBand } from '@/lib/palette.ts'
import { StoreyTooltip } from './StoreyTooltip.tsx'
import { SimulationOverlay } from './SimulationOverlay.tsx'
import { FoundationBlock, RoofCap, StoreyStack } from './scene/StoreyStack.tsx'
import { FloodWater } from './scene/FloodWater.tsx'
import { HazardArrows } from './scene/HazardArrows.tsx'
import { cumulativeDrift_m } from './scene/motion.ts'
import { useSimulationMotion } from './scene/useSimulationMotion.ts'
import { useNightProgress } from './scene/useNightProgress.ts'
import { World } from './scene/World.tsx'
import { useDesignStore } from '@/store/design.ts'
import { HAZARD_HEX, HAZARD_LABEL } from '@/lib/hazard.ts'
import { useSimulationStore } from '@/store/useSimulation.ts'

/**
 * Narrower than a typical 3D viewport. A long lens flattens perspective, which
 * is what makes a model read as a model rather than as a photograph taken from
 * a helicopter — the diorama look this scene is after. The framing maths below
 * reads this constant, so changing it re-fits the camera consistently.
 */
const CAMERA_FOV_DEG = 34

interface Dimensions {
  totalHeight_m: number
  footprintRadius_m: number
}

function measure(structure: Structure): Dimensions {
  let totalHeight_m = 0
  let widest = 0
  for (const storey of structure.storeys) {
    totalHeight_m += storey.height_m
    widest = Math.max(widest, Math.hypot(storey.widthX_m, storey.widthY_m))
  }
  return { totalHeight_m, footprintRadius_m: widest / 2 }
}

/**
 * Re-frames the camera when `trigger` changes, and once on mount.
 *
 * Deliberately does NOT depend on the building dimensions: refitting on every
 * change would yank the view every time a slider moves. The user asks for a
 * refit with the Frame button, and otherwise keeps the viewpoint they chose.
 */
function CameraRig({
  trigger,
  dimensions,
  controlsRef,
}: {
  trigger: number
  dimensions: Dimensions
  controlsRef: React.RefObject<ComponentRef<typeof OrbitControls> | null>
}) {
  const camera = useThree((state) => state.camera)

  // Latest-value ref: the refit needs current dimensions, but must not re-run
  // when they change. Written in an effect, not during render.
  const latest = useRef(dimensions)
  useEffect(() => {
    latest.current = dimensions
  }, [dimensions])

  useEffect(() => {
    const { totalHeight_m, footprintRadius_m } = latest.current
    const focusY = totalHeight_m / 2
    // Distance that fits a sphere of `radius` in the vertical field of view,
    // with 20% margin: d = r / sin(fov/2).
    const radius = Math.max(footprintRadius_m, totalHeight_m / 2, 6)
    const halfFov = ((CAMERA_FOV_DEG / 2) * Math.PI) / 180
    const distance = (radius / Math.sin(halfFov)) * 1.2

    const azimuth = Math.PI * 0.28
    const elevation = Math.PI * 0.16
    camera.position.set(
      distance * Math.cos(elevation) * Math.sin(azimuth),
      focusY + distance * Math.sin(elevation),
      distance * Math.cos(elevation) * Math.cos(azimuth),
    )
    camera.lookAt(0, focusY, 0)

    const controls = controlsRef.current
    if (controls) {
      controls.target.set(0, focusY, 0)
      controls.update()
    }
    // `camera`, `camera.position` and `controlsRef` are stable identities, so
    // in practice this fires on `trigger` alone. Dimensions are deliberately
    // absent — they come in through the ref above, because listing them would
    // refit the camera on every slider tick.
  }, [trigger, camera, camera.position, controlsRef])

  return null
}


/**
 * Orbit around the point under the cursor.
 *
 * OrbitControls cannot do this, and the reason is worth writing down. Its model
 * is spherical coordinates around `target`, and `update()` ends with
 * `camera.lookAt(target)` — so the target is simultaneously the pivot *and* the
 * thing at the centre of the screen. Move it onto the point under the cursor
 * and that point is yanked to the centre: a jump on every mouse-down, growing
 * with distance from centre.
 *
 * So rotation is done here instead, as a rigid rotation of the whole camera rig
 * about the cursor point P. Rotating a camera about P leaves P at exactly the
 * same coordinates in camera space, which means it stays pinned to the same
 * pixel — no jump at the start of the drag, and none during it. That is the
 * behaviour a CAD user expects: the thing you are pointing at stays put and the
 * world turns around it.
 *
 * The trick that keeps OrbitControls usable for everything else is rotating
 * `target` about P by the same quaternion as the camera. `camera.position` and
 * `target` are two points of one rigid body, so afterwards the camera is still
 * looking exactly at the target and OrbitControls' own bookkeeping — which
 * re-derives its spherical state from `position - target` on every update —
 * stays consistent. Pan, dolly, damping and `zoomToCursor` keep working
 * untouched; only `enableRotate` is handed over.
 *
 * The rotation itself is `lib/orbit.ts`, which is where the pinning property
 * is stated and tested against a real projection matrix.
 *
 * A drag that starts over empty space falls back to the existing target, which
 * is ordinary orbit behaviour. Double-click still recentres on a point, which
 * is now a convenience rather than a necessity. Wheel zoom is OrbitControls'
 * `zoomToCursor`.
 */
function CursorPivot({
  controlsRef,
}: {
  controlsRef: React.RefObject<ComponentRef<typeof OrbitControls> | null>
}) {
  const camera = useThree((state) => state.camera)
  const scene = useThree((state) => state.scene)
  const raycaster = useThree((state) => state.raycaster)
  const domElement = useThree((state) => state.gl.domElement)

  // Where a double-click is gliding the target to. Null when nothing is moving.
  const glideTo = useRef<Vector3 | null>(null)

  useEffect(() => {
    // Allocated once and reused: this runs on every pointermove, and a drag
    // that allocates per frame is a drag that stutters on GC.
    const ndc = new Vector2()
    const pivot = new Vector3()

    let activePointer: number | null = null
    let lastX = 0
    let lastY = 0

    function pointUnderCursor(event: MouseEvent): Vector3 | null {
      const rect = domElement.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      ndc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster
        .intersectObjects(scene.children, true)
        .find((intersection) => intersection.object.visible)
      return hit ? hit.point.clone() : null
    }

    function onPointerDown(event: PointerEvent) {
      const controls = controlsRef.current
      if (!controls || event.button !== 0) return

      // A second finger means a pinch, which is OrbitControls' gesture, not
      // ours. Drop the drag rather than fighting it for the camera.
      if (activePointer !== null) {
        activePointer = null
        return
      }

      // Empty space has no point to pivot on; the existing target is the
      // sensible fallback and gives plain orbit behaviour.
      pivot.copy(pointUnderCursor(event) ?? controls.target)
      activePointer = event.pointerId
      lastX = event.clientX
      lastY = event.clientY
      glideTo.current = null
    }

    function onPointerMove(event: PointerEvent) {
      const controls = controlsRef.current
      if (!controls || activePointer !== event.pointerId) return

      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      lastX = event.clientX
      lastY = event.clientY

      rotateAboutPivot(camera.position, controls.target, pivot, {
        dx,
        dy,
        height: domElement.clientHeight || 1,
        minPolarAngle: controls.minPolarAngle,
        maxPolarAngle: controls.maxPolarAngle,
      })
      controls.update()
    }

    function onPointerUp(event: PointerEvent) {
      if (activePointer === event.pointerId) activePointer = null
    }

    function onDoubleClick(event: MouseEvent) {
      const point = pointUnderCursor(event)
      if (point !== null) glideTo.current = point
    }

    domElement.addEventListener('pointerdown', onPointerDown)
    domElement.addEventListener('dblclick', onDoubleClick)
    // Move and release go on the window: a drag that runs off the edge of the
    // canvas should keep rotating, and releasing out there should still end it.
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      domElement.removeEventListener('pointerdown', onPointerDown)
      domElement.removeEventListener('dblclick', onDoubleClick)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [camera, scene, raycaster, domElement, controlsRef])

  useFrame((_, delta) => {
    const controls = controlsRef.current
    const destination = glideTo.current
    if (!controls || destination === null) return

    // Exponential smoothing: frame-rate independent, always converging, and it
    // needs no start time or duration to keep in sync.
    controls.target.lerp(destination, 1 - Math.exp(-delta * 12))
    if (controls.target.distanceTo(destination) < 0.01) {
      controls.target.copy(destination)
      glideTo.current = null
    }
    controls.update()
  })

  return null
}

function Scene({
  result,
  structure,
  hazard,
  frameNonce,
  hoveredStoreyIndex,
  onHoverStorey,
  onHoverStoreyEnd,
}: {
  result: AnalysisResult
  structure: Structure
  hazard: Hazard
  frameNonce: number
  hoveredStoreyIndex: number | null
  onHoverStorey: (index: number, clientX: number, clientY: number) => void
  onHoverStoreyEnd: (index: number) => void
}) {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)
  const selectedStoreyIndex = useDesignStore((state) => state.selectedStoreyIndex)
  const selectStorey = useDesignStore((state) => state.selectStorey)
  const dimensions = measure(structure)
  // Where the event is up to. A ref the scene reads per frame; the phase it is
  // derived from is state, and it changes three times per run.
  const motion = useSimulationMotion(hazard.kind)
  const phase = useSimulationStore((state) => state.phase)
  // Damage is drawn only while an event is being shown. Dismissing the
  // simulation puts the student back in front of an intact building to edit,
  // which is the point of dismissing it.
  const showDamage = phase === 'impact' || phase === 'aftermath'
  // Engine plan X -> three X, plan Y -> three Z, as everywhere in this folder.
  const loadDirection = (hazard.directionDeg * Math.PI) / 180
  const topPose = {
    index: result.storeys.length - 1,
    cumulativeDrift_m:
      cumulativeDrift_m(result.storeys.map((s) => s.drift_m)).at(-1) ?? 0,
    width_m: Math.min(
      structure.storeys.at(-1)?.widthX_m ?? 1,
      structure.storeys.at(-1)?.widthY_m ?? 1,
    ),
    collapseIndex: showDamage ? result.damage.collapseIndex : null,
    height_m: structure.storeys.at(-1)?.height_m ?? 3,
  }
  // Stable, because the scenery below it is memoised on this prop: a fresh
  // closure every render would rebuild several hundred instanced objects on
  // every slider tick.
  const clearSelection = useCallback(() => selectStorey(null), [selectStorey])
  // Owned here, not inside the world, because the student's own windows come
  // on at the same moment the neighbourhood's do.
  const night = useNightProgress(dimensions.totalHeight_m)

  return (
    <>
      <World night={night} onGroundClick={clearSelection} />

      <FoundationBlock structure={structure} />
      <StoreyStack
        structure={structure}
        storeys={result.storeys}
        selectedStoreyIndex={selectedStoreyIndex}
        onSelect={selectStorey}
        hoveredStoreyIndex={hoveredStoreyIndex}
        night={night}
        motion={motion}
        damage={result.damage}
        showDamage={showDamage}
        directionDeg={hazard.directionDeg}
        onHover={onHoverStorey}
        onHoverEnd={onHoverStoreyEnd}
      />
      <RoofCap
        structure={structure}
        motion={motion}
        pose={topPose}
        direction={[Math.cos(loadDirection), Math.sin(loadDirection)]}
      />
      <HazardArrows
        storeys={result.storeys}
        hazard={hazard}
        footprintRadius_m={dimensions.footprintRadius_m}
      />
      {/* Scenery, not analysis: how deep the water is, which is something the
          student typed. What the water is doing to the building is the arrows
          and the storey colours. */}
      {hazard.kind === 'flood' && (
        <FloodWater depth_m={hazard.depth_m} />
      )}

      <CameraRig
        trigger={frameNonce}
        dimensions={dimensions}
        controlsRef={controlsRef}
      />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={5}
        maxDistance={600}
        // Rotation is CursorPivot's, so that it can happen about the point
        // under the cursor instead of about the target. Everything else here
        // -- pan, dolly, damping, limits -- stays with OrbitControls.
        enableRotate={false}
        // Dolly toward the pointer rather than the screen centre.
        zoomToCursor
        // Stop the camera going under the ground plane.
        maxPolarAngle={Math.PI / 2 - 0.02}
      />
      <CursorPivot controlsRef={controlsRef} />
    </>
  )
}

const LEGEND_BANDS: readonly UtilizationBand[] = ['safe', 'caution', 'fail']

export interface ViewportProps {
  result: AnalysisResult
  structure: Structure
  hazard: Hazard
}

/** Gap between the pointer and the hover card, in CSS pixels. */
const TOOLTIP_OFFSET_PX = 16
/** Card width plus the offset; past this from the right edge, it flips. */
const TOOLTIP_REACH_PX = 240

export function Viewport({ result, structure, hazard }: ViewportProps) {
  const [frameNonce, setFrameNonce] = useState(0)
  const simulationPhase = useSimulationStore((state) => state.phase)
  const startSimulation = useSimulationStore((state) => state.start)
  const dismissSimulation = useSimulationStore((state) => state.dismiss)
  const running = simulationPhase !== 'idle'

  // Editing the design or changing the hazard ends the run. The aftermath on
  // screen belongs to a particular building meeting a particular event, and
  // leaving a collapsed tower standing over a design the student has since
  // changed would make the picture a lie about the numbers beside it.
  useEffect(() => {
    dismissSimulation()
    // Deliberately keyed on identity: every store action replaces the object it
    // touches, so "same object" and "unchanged" are the same question.
  }, [structure, hazard, dismissSimulation])

  // Which storey the pointer is over. State, because it changes the card's
  // contents and the storey's own highlight.
  const [hoveredStorey, setHoveredStorey] = useState<number | null>(null)
  // Where the card sits. *Not* state: this changes on every pointermove, and a
  // render per move would re-run the whole scene tree to move one div. The
  // wrapper is always mounted so the ref is live before the first hover.
  const tooltipRef = useRef<HTMLDivElement>(null)
  // A drag is an orbit, not an inspection; a card chasing the cursor through
  // one is noise. Cleared on press, and hover returns on the next move.
  const dragging = useRef(false)

  useEffect(() => {
    const onDown = () => {
      dragging.current = true
      setHoveredStorey(null)
    }
    const onUp = () => {
      dragging.current = false
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  const handleHoverStorey = useCallback(
    (index: number, clientX: number, clientY: number) => {
      if (dragging.current) return
      const node = tooltipRef.current
      if (node) {
        // Right of the pointer normally; flipped to the left near the edge of
        // the window, where it would otherwise run off screen.
        const flip = clientX > window.innerWidth - TOOLTIP_REACH_PX
        node.style.left = `${clientX + (flip ? -TOOLTIP_OFFSET_PX : TOOLTIP_OFFSET_PX)}px`
        node.style.top = `${clientY}px`
        node.style.transform = flip
          ? 'translate(-100%, -50%)'
          : 'translate(0, -50%)'
      }
      // Same index re-set is a no-op for React, so moving across one storey
      // costs nothing but the two style writes above.
      setHoveredStorey((current) => (current === index ? current : index))
    },
    [],
  )

  const handleHoverStoreyEnd = useCallback((index: number) => {
    // Only if it is still the one we think is hovered: moving from one storey
    // to the next fires an exit and an entry, and this is order-independent.
    setHoveredStorey((current) => (current === index ? null : current))
  }, [])

  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [34, 26, 38], fov: CAMERA_FOV_DEG, near: 0.1, far: 2000 }}
      >
        <Scene
          result={result}
          structure={structure}
          hazard={hazard}
          frameNonce={frameNonce}
          hoveredStoreyIndex={hoveredStorey}
          onHoverStorey={handleHoverStorey}
          onHoverStoreyEnd={handleHoverStoreyEnd}
        />
      </Canvas>

      {/* Fixed, so the client coordinates written above need no conversion,
          and always mounted so the ref exists before the first hover. */}
      <div
        ref={tooltipRef}
        className="pointer-events-none fixed left-0 top-0 z-20"
        aria-hidden="true"
      >
        <StoreyTooltip
          result={result}
          structure={structure}
          index={hoveredStorey}
        />
      </div>

      {/* Chrome over the canvas is paper, like the rest of the studio, and
          opaque enough to hold its own against both a midday sky and a night
          one — the background under it moves through the whole day. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <ul className="pointer-events-auto flex gap-3 rounded-full border-2 border-ink bg-paper/95 px-3 py-1.5 text-xs shadow-[3px_3px_0_0_var(--color-ink)]">
          {LEGEND_BANDS.map((band) => (
            <li key={band} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-full border border-ink"
                style={{ backgroundColor: BAND_HEX[band] }}
              />
              <span className="text-ink/70">{BAND_LABEL[band]}</span>
            </li>
          ))}
        </ul>
        <div className="pointer-events-auto flex items-center gap-2" data-tour="simulate">
          {/* The headline action of the whole studio, so it wears the hazard's
              own colour rather than the chrome's white. */}
          <button
            type="button"
            onClick={() => startSimulation(hazard.kind)}
            disabled={running}
            title={`Run the ${HAZARD_LABEL[hazard.kind].toLowerCase()} against this design`}
            className="rounded-full border-2 border-ink px-3.5 py-1.5 font-display text-xs text-ink shadow-[3px_3px_0_0_var(--color-ink)] transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-45"
            style={{ backgroundColor: HAZARD_HEX[hazard.kind] }}
          >
            ▶ Start a simulation
          </button>
          <button
            type="button"
            onClick={() => setFrameNonce((nonce) => nonce + 1)}
            className="rounded-full border-2 border-ink bg-white px-3 py-1.5 font-display text-xs text-ink shadow-[3px_3px_0_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
          >
            Frame view
          </button>
        </div>
      </div>

      <SimulationOverlay result={result} hazard={hazard} />

      {/* On a chip, not bare text: the sky behind it runs from midday blue to
          midnight, and no single text colour is legible against both. */}
      {!running && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
          <p className="rounded-full border-2 border-ink/70 bg-paper/90 px-3.5 py-1.5 text-center text-[0.7rem] text-ink/70">
            Drag to orbit &middot; scroll to zoom at the cursor &middot;
            double-click to re-centre &middot; click a storey to edit it
          </p>
        </div>
      )}
    </div>
  )
}
