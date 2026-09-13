/**
 * The water, when the hazard is a flood.
 *
 * A translucent plane at the stillwater depth, wide enough to reach the fog,
 * with a slow ripple written straight into the shader. It reads one number off
 * the hazard — the depth the student set — and nothing off the analysis, which
 * puts it on the *scenery* side of the line `Viewport.tsx` draws: it is how
 * high the water is, not a claim about what the water is doing to the building.
 * The arrows and the storey colours are the claims.
 *
 * It is still worth drawing, because the depth is otherwise invisible. A flood
 * that only exists as a slider and a set of short arrows near the ground is a
 * flood a student has to be told about; one they can see up the side of the
 * building is one they can reason about.
 *
 * The ripple is a sine of position and time in the fragment shader rather than
 * a normal map, for the same reason nothing else in this scene fetches an
 * asset: a texture is a network request, and the viewport must look right on a
 * demo laptop with no wifi.
 */

import { useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { DoubleSide, type Mesh, type ShaderMaterial } from 'three'
import { GROUND_EXTENT_M } from './scenery.ts'
import type { SimulationMotion } from './motion.ts'

/** Deep enough to read as water, sheer enough to see the building through. */
const OPACITY = 0.62

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

/**
 * Two sine waves crossing at an angle, which is the cheapest thing that does
 * not read as a repeating grid, plus a slow brightening towards the horizon so
 * the plane does not look like a flat sheet of plastic.
 */
const FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  uniform float uTime;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform float uOpacity;
  varying vec2 vWorld;

  void main() {
    float a = sin(vWorld.x * 0.11 + uTime * 0.9);
    float b = sin(vWorld.y * 0.17 - uTime * 0.6);
    float c = sin((vWorld.x + vWorld.y) * 0.05 + uTime * 0.35);
    float ripple = (a * 0.4 + b * 0.35 + c * 0.25) * 0.5 + 0.5;
    vec3 colour = mix(uDeep, uShallow, ripple);
    // A brighter crest where the waves line up, so the surface catches light.
    colour += pow(ripple, 6.0) * 0.35;
    gl_FragColor = vec4(colour, uOpacity);
  }
`

export interface FloodWaterProps {
  /** Stillwater depth above grade. At or below zero, nothing is drawn. */
  depth_m: number
  /**
   * Where the simulation is up to. While an event is running the surface rises
   * from grade to `depth_m`; at rest it simply sits at the depth the student
   * set, because a flood is a condition the building stands in rather than
   * something that arrives.
   */
  motion: RefObject<SimulationMotion>
}

export function FloodWater({ depth_m, motion }: FloodWaterProps) {
  const material = useRef<ShaderMaterial>(null)
  const surface = useRef<Mesh>(null)
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uShallow: { value: [0.41, 0.66, 0.83] },
      uDeep: { value: [0.11, 0.31, 0.47] },
      uOpacity: { value: OPACITY },
    }),
    [],
  )

  useFrame((state) => {
    const shader = material.current
    if (shader) shader.uniforms['uTime']!.value = state.clock.elapsedTime
    const mesh = surface.current
    if (mesh) mesh.position.y = depth_m * motion.current.waterRise
  })

  if (depth_m <= 0) return null

  return (
    <mesh
      ref={surface}
      // Flat at the water line, facing up. Rotated rather than built in the XZ
      // plane so the plane geometry's own UVs stay conventional.
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, depth_m, 0]}
      // Never casts or receives: a shadow on a transparent surface at a shallow
      // sun angle reads as dirt, and the surface is not opaque enough to hold
      // one anyway.
      renderOrder={2}
    >
      <planeGeometry args={[GROUND_EXTENT_M, GROUND_EXTENT_M]} />
      <shaderMaterial
        ref={material}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        uniforms={uniforms}
        transparent
        // Seen from below as well, because the camera can drop under the
        // surface while orbiting a half-submerged building.
        side={DoubleSide}
        // Off, so the building behind the water still draws. The plane is the
        // last thing rendered instead.
        depthWrite={false}
      />
    </mesh>
  )
}
