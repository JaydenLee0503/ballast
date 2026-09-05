/**
 * The 3D view. Renders the structure from `AnalysisResult`, nothing more:
 * every colour and every arrow length traces to a field the engine produced.
 *
 * Lighting is entirely local (ambient + hemisphere + one shadowing
 * directional). No `<Environment>` and no drei `<Text>` — both fetch assets
 * from a CDN at runtime, which would make the viewport depend on the network
 * and on a third party staying up during a demo.
 */

import { useEffect, useRef, useState, type ComponentRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import type { AnalysisResult, Structure, WindHazard } from '@/engine'
import { BAND_HEX, BAND_LABEL, type UtilizationBand } from '@/lib/palette.ts'
import { FoundationBlock, StoreyStack } from './scene/StoreyStack.tsx'
import { WindArrows } from './scene/WindArrows.tsx'
import { useDesignStore } from '@/store/design.ts'

const CAMERA_FOV_DEG = 45

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

function Scene({
  result,
  structure,
  hazard,
  frameNonce,
}: {
  result: AnalysisResult
  structure: Structure
  hazard: WindHazard
  frameNonce: number
}) {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)
  const selectedStoreyIndex = useDesignStore((state) => state.selectedStoreyIndex)
  const selectStorey = useDesignStore((state) => state.selectStorey)
  const dimensions = measure(structure)
  const shadowExtent = Math.max(40, dimensions.footprintRadius_m * 3)

  return (
    <>
      <color attach="background" args={['#0c0a09']} />
      <fog attach="fog" args={['#0c0a09', 120, 420]} />

      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#cbd5e1', '#1c1917', 0.7]} />
      <directionalLight
        castShadow
        position={[38, 52, 26]}
        intensity={2.2}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
        shadow-camera-far={220}
      />

      {/* Ground. Clicking it clears the storey selection, which is the
          gesture people reach for without being told. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        receiveShadow
        onClick={() => selectStorey(null)}
      >
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color="#1c1917" roughness={1} />
      </mesh>
      <Grid
        position={[0, 0.01, 0]}
        infiniteGrid
        cellSize={1}
        sectionSize={10}
        cellColor="#292524"
        sectionColor="#44403c"
        fadeDistance={180}
        fadeStrength={1.5}
        followCamera={false}
      />

      <FoundationBlock structure={structure} />
      <StoreyStack
        structure={structure}
        storeys={result.storeys}
        selectedStoreyIndex={selectedStoreyIndex}
        onSelect={selectStorey}
      />
      <WindArrows
        storeys={result.storeys}
        hazard={hazard}
        footprintRadius_m={dimensions.footprintRadius_m}
      />

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
        // Stop the camera going under the ground plane.
        maxPolarAngle={Math.PI / 2 - 0.02}
      />
    </>
  )
}

const LEGEND_BANDS: readonly UtilizationBand[] = ['safe', 'caution', 'fail']

export interface ViewportProps {
  result: AnalysisResult
  structure: Structure
  hazard: WindHazard
}

export function Viewport({ result, structure, hazard }: ViewportProps) {
  const [frameNonce, setFrameNonce] = useState(0)

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
        />
      </Canvas>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <ul className="pointer-events-auto flex gap-4 rounded-md border border-neutral-800 bg-neutral-950/80 px-3 py-2 text-xs backdrop-blur">
          {LEGEND_BANDS.map((band) => (
            <li key={band} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-sm"
                style={{ backgroundColor: BAND_HEX[band] }}
              />
              <span className="text-neutral-400">{BAND_LABEL[band]}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setFrameNonce((nonce) => nonce + 1)}
          className="pointer-events-auto rounded-md border border-neutral-800 bg-neutral-950/80 px-3 py-2 text-xs text-neutral-300 backdrop-blur hover:border-neutral-600 hover:text-neutral-100"
        >
          Frame view
        </button>
      </div>

      <p className="pointer-events-none absolute inset-x-0 bottom-0 p-4 text-center text-xs text-neutral-600">
        Drag to orbit &middot; scroll to zoom &middot; click a storey to edit it
      </p>
    </div>
  )
}
