/**
 * The world the design sits in: sky, sun, streets, trees, traffic, neighbours.
 *
 * Why a diorama and not a grid. A tower is only tall next to something; a
 * safety factor is only alarming if the thing that falls over is a building in
 * a street. The scenery is here to give the numbers a body — and to make the
 * studio feel like a place a student is building in rather than a chart with
 * boxes on it.
 *
 * What keeps that honest is the same rule the rest of the viewport follows:
 * **the scenery invents nothing and means nothing.** No neighbour, tree, road
 * or star reads an `AnalysisResult`, and none of them feeds one. The only
 * input is `totalHeight_m` — a property of the structure the student typed in,
 * not a figure the engine derived — and all it drives is the time of day. The
 * things that *do* mean something (storey colour, arrow length) are still
 * `StoreyStack` and `WindArrows`, still straight off the engine, and are still
 * the only saturated colours in the frame.
 *
 * Time of day is the one piece of feedback the world gives back: the taller
 * the tower, the later it gets, until the neighbourhood's windows come on. The
 * mapping is `lib/sky.ts`, which is pure and tested, so "taller means darker"
 * is a property rather than a vibe.
 *
 * No runtime asset fetches, as everywhere else in the scene: no textures, no
 * HDRIs, no fonts. The sky is a two-colour shader, the windows are a hash in
 * the fragment shader, and the star field is 900 seeded directions. A demo
 * that needs a CDN is a demo that fails on conference wifi.
 */

import { memo, useMemo, useRef } from 'react'
import { Instance, Instances } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  BackSide,
  Color,
  type DirectionalLight,
  type Fog,
  type Group,
  type HemisphereLight,
  type Light,
  MeshStandardMaterial,
  type Mesh,
  type MeshBasicMaterial,
  type PointsMaterial,
  type Points,
} from 'three'
import { nightProgress, skyPalette, sunDirection } from '@/lib/sky.ts'
import {
  CARS,
  DASHES,
  DASH_LENGTH_M,
  GROUND_EXTENT_M,
  NEIGHBOURS,
  ROAD_CENTRES_M,
  ROAD_HALF_M,
  ROAD_LENGTH_M,
  SIDEWALK_SLABS,
  SITE_PAD_HALF_M,
  STAR_DIRECTIONS,
  TREES,
} from './scenery.ts'

/** Radius of the sky dome. Must exceed OrbitControls' `maxDistance`. */
const SKY_RADIUS_M = 900
/** How far out the sun disc sits; inside the dome, so it reads against it. */
const SUN_DISTANCE_M = 800
/** Where the shadow-casting light is parked along the sun direction. */
const KEY_LIGHT_DISTANCE_M = 320
/**
 * Half-width of the shadow camera, perpendicular to the light. Covers the plot
 * and the streets around it; blocks beyond cast into nothing, which nobody
 * notices and the shadow map very much does. Kept modest because the box's
 * *ground* footprint grows as 1/sin(sun elevation), and the sun spends the
 * back half of the day low (see `sky.ts`).
 */
const SHADOW_EXTENT_M = 120
/** Seconds-ish constant for easing the sky toward its target. */
const SKY_EASE_RATE = 2.2

const GRASS_HEX = '#5c7746'
const ASPHALT_HEX = '#33333a'
const SIDEWALK_HEX = '#8e8b85'
const PAD_HEX = '#a1978a'
const TRUNK_HEX = '#5a4433'
const GLASS_HEX = '#2a3038'

/**
 * The sky is a vertical two-colour blend across the dome. `smoothstep` rather
 * than a straight mix so the warm band stays low and tight to the horizon,
 * which is where it is in the evenings this is imitating.
 */
const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  varying vec3 vDirection;
  void main() {
    float height = smoothstep(0.0, 0.62, vDirection.y);
    gl_FragColor = vec4(mix(uHorizon, uZenith, height), 1.0);
    // A ShaderMaterial writes gl_FragColor raw: three's tone-mapping and
    // output-colour-space steps are chunks the built-in materials include and
    // this one has to include too. Without them the sky sits in a different
    // colour space from every lit surface in front of it.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** Opts an object out of raycasting; see the celestial group below. */
const NEVER_HIT = () => null

/** Star directions, pushed just inside the dome so they draw against it. */
const STAR_POSITIONS: Float32Array = STAR_DIRECTIONS.map(
  (component) => component * SKY_RADIUS_M * 0.97,
)

/**
 * The neighbourhood's facades, with windows that come on after dark.
 *
 * The windows are a hash in the fragment shader rather than a texture — the
 * scene fetches nothing at runtime — evaluated in metres of facade rather than
 * in UV, so a 60 m tower and a 10 m walk-up get the same size of window
 * instead of the same *number* of them. `instanceMatrix` supplies the per
 * instance scale, which is why this material is only ever used on an
 * `InstancedMesh`.
 *
 * The one thing that changes about it is how brightly those windows burn, and
 * that is handed back as a setter rather than as the uniform itself: the
 * uniform object has to stay the exact one the compiled program holds, so
 * nothing outside here should be in a position to replace it.
 */
function useFacadeMaterial() {
  return useMemo(() => {
    const glow = { value: 0 }
    const material = new MeshStandardMaterial({ roughness: 0.88, metalness: 0 })

    material.onBeforeCompile = (shader) => {
      shader.uniforms['uWindowGlow'] = glow
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vFacadePos;
           varying vec3 vFacadeNormal;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vec3 facadeScale = vec3(
             length(instanceMatrix[0].xyz),
             length(instanceMatrix[1].xyz),
             length(instanceMatrix[2].xyz)
           );
           vFacadePos = position * facadeScale;
           vFacadeNormal = normal;`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uWindowGlow;
           varying vec3 vFacadePos;
           varying vec3 vFacadeNormal;
           float facadeHash(vec2 cell) {
             vec2 p = fract(cell * vec2(123.34, 456.21));
             p += dot(p, p + 45.32);
             return fract(p.x * p.y);
           }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           if (uWindowGlow > 0.001) {
             vec3 face = abs(vFacadeNormal);
             // Roofs get no windows; only the four walls.
             if (face.y < 0.5) {
               vec2 wall = face.x > 0.5 ? vFacadePos.zy : vFacadePos.xy;
               vec2 grid = wall / vec2(3.4, 3.6);
               float lit = step(0.58, facadeHash(floor(grid)));
               vec2 within = fract(grid);
               float pane =
                 step(0.20, within.x) * step(within.x, 0.80) *
                 step(0.26, within.y) * step(within.y, 0.74);
               totalEmissiveRadiance +=
                 vec3(1.0, 0.78, 0.45) * lit * pane * uWindowGlow * 1.8;
             }
           }`,
        )
    }

    return {
      material,
      setWindowGlow(value: number) {
        glow.value = value
      },
    }
  }, [])
}

/**
 * Streets, pavements and the prepared pad the design stands on.
 *
 * The flat layers — grass, carriageway, markings, pad — are all at y = 0 and
 * separated with `polygonOffset` rather than with millimetres of height. Depth
 * precision at the far end of a 0.1 m near plane is coarser than the gaps a
 * stack of road markings wants, so height offsets that look fine up close
 * shimmer when the camera pulls back to frame a tall building. Polygon offset
 * is scale-free and does not.
 */
const Ground = memo(function Ground({
  onGroundClick,
}: {
  onGroundClick: () => void
}) {
  return (
    <group onClick={onGroundClick}>
      {/* Open ground. Everything else is laid on top of it. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[GROUND_EXTENT_M, GROUND_EXTENT_M]} />
        <meshStandardMaterial color={GRASS_HEX} roughness={1} />
      </mesh>

      {/* Carriageways: one strip per centreline, in both directions. The two
          sets overlap at every junction, at the same depth and in the same
          colour, so there is nothing there to see fighting. */}
      {ROAD_CENTRES_M.map((centre) => (
        <mesh
          key={`road-x-${centre}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0, centre]}
          receiveShadow
        >
          <planeGeometry args={[ROAD_LENGTH_M, 2 * ROAD_HALF_M]} />
          <meshStandardMaterial
            color={ASPHALT_HEX}
            roughness={0.95}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      ))}
      {ROAD_CENTRES_M.map((centre) => (
        <mesh
          key={`road-z-${centre}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[centre, 0, 0]}
          receiveShadow
        >
          <planeGeometry args={[2 * ROAD_HALF_M, ROAD_LENGTH_M]} />
          <meshStandardMaterial
            color={ASPHALT_HEX}
            roughness={0.95}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      ))}

      {/* Lane markings. */}
      <Instances
        limit={DASHES.length * ROAD_CENTRES_M.length * 2}
        frames={4}
        castShadow={false}
      >
        <boxGeometry args={[DASH_LENGTH_M, 0.02, 0.32]} />
        <meshStandardMaterial
          color="#cfc9b4"
          roughness={0.9}
          polygonOffset
          polygonOffsetFactor={-3}
          polygonOffsetUnits={-3}
        />
        {ROAD_CENTRES_M.map((centre) =>
          DASHES.map((dash) => (
            <Instance
              key={`dash-x-${centre}-${dash.along}`}
              position={[dash.along, 0.01, centre]}
            />
          )),
        )}
        {ROAD_CENTRES_M.map((centre) =>
          DASHES.map((dash) => (
            <Instance
              key={`dash-z-${centre}-${dash.along}`}
              position={[centre, 0.01, dash.along]}
              rotation={[0, Math.PI / 2, 0]}
            />
          )),
        )}
      </Instances>

      {/* Pavements: a kerb-height ring around every block. Real geometry, not
          a decal, so the kerb reads as a step at ground level. */}
      <Instances limit={SIDEWALK_SLABS.length} frames={4} receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={SIDEWALK_HEX} roughness={1} />
        {SIDEWALK_SLABS.map((slab, index) => (
          <Instance
            key={index}
            position={[slab.x, 0.09, slab.z]}
            scale={[slab.spanX, 0.18, slab.spanZ]}
          />
        ))}
      </Instances>

      {/* The plot: hardstanding rather than grass, because this is a site with
          a building going up on it. Clicking it clears the storey selection,
          which is the gesture people reach for without being told. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[SITE_PAD_HALF_M * 2, SITE_PAD_HALF_M * 2]} />
        <meshStandardMaterial
          color={PAD_HEX}
          roughness={1}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
    </group>
  )
})

/** Neighbours, street trees and parked traffic. */
const City = memo(function City({
  facadeMaterial,
}: {
  facadeMaterial: MeshStandardMaterial
}) {
  const broadleaf = TREES.filter((tree) => tree.kind === 'broadleaf')
  const conifer = TREES.filter((tree) => tree.kind === 'conifer')

  return (
    <group>
      <Instances
        limit={NEIGHBOURS.length}
        frames={4}
        material={facadeMaterial}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        {NEIGHBOURS.map((building, index) => (
          <Instance
            key={index}
            position={[building.x, building.height_m / 2, building.z]}
            scale={[building.widthX_m, building.height_m, building.widthZ_m]}
            color={building.color}
          />
        ))}
      </Instances>

      <Instances limit={TREES.length} frames={4} castShadow>
        <cylinderGeometry args={[0.2, 0.3, 2.6, 6]} />
        <meshStandardMaterial color={TRUNK_HEX} roughness={1} />
        {TREES.map((tree, index) => (
          <Instance
            key={index}
            position={[tree.x, 1.3 * tree.scale, tree.z]}
            scale={tree.scale}
          />
        ))}
      </Instances>

      <Instances limit={Math.max(1, broadleaf.length)} frames={4} castShadow>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#ffffff" roughness={1} flatShading />
        {broadleaf.map((tree, index) => (
          <Instance
            key={index}
            position={[tree.x, 4 * tree.scale, tree.z]}
            scale={[2.3 * tree.scale, 2.1 * tree.scale, 2.3 * tree.scale]}
            color={tree.foliage}
          />
        ))}
      </Instances>

      <Instances limit={Math.max(1, conifer.length)} frames={4} castShadow>
        <coneGeometry args={[1, 1, 7]} />
        <meshStandardMaterial color="#ffffff" roughness={1} flatShading />
        {conifer.map((tree, index) => (
          <Instance
            key={index}
            position={[tree.x, 4.6 * tree.scale, tree.z]}
            scale={[1.9 * tree.scale, 5.4 * tree.scale, 1.9 * tree.scale]}
            color={tree.foliage}
          />
        ))}
      </Instances>

      <Instances limit={Math.max(1, CARS.length)} frames={4} castShadow>
        <boxGeometry args={[4.3, 1.15, 1.9]} />
        <meshStandardMaterial color="#ffffff" roughness={0.45} metalness={0.15} />
        {CARS.map((car, index) => (
          <Instance
            key={index}
            position={[car.x, 0.62, car.z]}
            rotation={[0, car.rotationY, 0]}
            color={car.color}
          />
        ))}
      </Instances>
      <Instances limit={Math.max(1, CARS.length)} frames={4} castShadow>
        <boxGeometry args={[2.1, 0.8, 1.68]} />
        <meshStandardMaterial color={GLASS_HEX} roughness={0.25} metalness={0.3} />
        {CARS.map((car, index) => (
          <Instance
            key={index}
            position={[car.x, 1.55, car.z]}
            rotation={[0, car.rotationY, 0]}
          />
        ))}
      </Instances>
    </group>
  )
})

export interface WorldProps {
  /** Total height of the design. Drives the time of day and nothing else. */
  totalHeight_m: number
  onGroundClick: () => void
}

export function World({ totalHeight_m, onGroundClick }: WorldProps) {
  const facade = useFacadeMaterial()

  // Eased, so adding a storey slides the light along rather than cutting to a
  // new time of day. Seeded at the target so the first frame is already right.
  const night = useRef(nightProgress(totalHeight_m))

  const keyLight = useRef<DirectionalLight>(null)
  const hemisphere = useRef<HemisphereLight>(null)
  const ambient = useRef<Light>(null)
  const fog = useRef<Fog>(null)
  const celestial = useRef<Group>(null)
  const sun = useRef<Mesh>(null)
  const sunMaterial = useRef<MeshBasicMaterial>(null)
  const glowMaterial = useRef<MeshBasicMaterial>(null)
  const stars = useRef<Points>(null)
  const starMaterial = useRef<PointsMaterial>(null)

  const skyUniforms = useMemo(
    () => ({
      uZenith: { value: new Color('#2f74d0') },
      uHorizon: { value: new Color('#bfe1f5') },
    }),
    [],
  )

  useFrame((state, delta) => {
    const target = nightProgress(totalHeight_m)
    night.current += (target - night.current) * (1 - Math.exp(-delta * SKY_EASE_RATE))
    const t = night.current
    const palette = skyPalette(t)
    const direction = sunDirection(t)

    skyUniforms.uZenith.value.setHex(palette.zenith)
    skyUniforms.uHorizon.value.setHex(palette.horizon)

    if (fog.current) fog.current.color.setHex(palette.horizon)

    if (keyLight.current) {
      keyLight.current.color.setHex(palette.key)
      keyLight.current.intensity = palette.keyIntensity
      keyLight.current.position.set(
        direction.x * KEY_LIGHT_DISTANCE_M,
        direction.y * KEY_LIGHT_DISTANCE_M,
        direction.z * KEY_LIGHT_DISTANCE_M,
      )
    }
    if (hemisphere.current) {
      hemisphere.current.color.setHex(palette.hemisphereSky)
      hemisphere.current.groundColor.setHex(palette.hemisphereGround)
      hemisphere.current.intensity = palette.hemisphereIntensity
    }
    if (ambient.current) ambient.current.intensity = palette.ambientIntensity

    // Sky, sun and stars ride with the camera, so the horizon stays at eye
    // level and the sun keeps its bearing however far the view is panned.
    if (celestial.current) celestial.current.position.copy(state.camera.position)
    if (sun.current) {
      sun.current.position.set(
        direction.x * SUN_DISTANCE_M,
        direction.y * SUN_DISTANCE_M,
        direction.z * SUN_DISTANCE_M,
      )
    }
    if (sunMaterial.current) sunMaterial.current.color.setHex(palette.key)
    if (glowMaterial.current) {
      glowMaterial.current.color.setHex(palette.key)
      glowMaterial.current.opacity = 0.18 + 0.22 * (1 - t)
    }
    if (starMaterial.current) starMaterial.current.opacity = palette.starOpacity
    if (stars.current) stars.current.visible = palette.starOpacity > 0.01

    facade.setWindowGlow(palette.windowGlow)
  })

  return (
    <>
      {/* Haze, matched to the horizon so the far blocks dissolve into the sky
          rather than ending. It starts past the distance the camera frames a
          tall building from, so the design itself is never washed out by it. */}
      <fog ref={fog} attach="fog" args={['#bfe1f5', 220, 950]} />

      <ambientLight ref={ambient} intensity={0.45} />
      <hemisphereLight ref={hemisphere} intensity={0.95} />
      <directionalLight
        ref={keyLight}
        castShadow
        intensity={2.6}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-SHADOW_EXTENT_M}
        shadow-camera-right={SHADOW_EXTENT_M}
        shadow-camera-top={SHADOW_EXTENT_M}
        shadow-camera-bottom={-SHADOW_EXTENT_M}
        shadow-camera-near={1}
        shadow-camera-far={900}
        shadow-bias={-0.0004}
        shadow-normalBias={0.06}
      />

      {/* Sky, stars and sun are excluded from raycasting. The dome is a
          back-faced sphere the camera sits inside, so every ray would hit it,
          and `CursorPivot` would happily orbit about a point 900 m away. */}
      <group ref={celestial} raycast={NEVER_HIT}>
        {/* The sky itself: one gradient, horizon to zenith, seen from inside.
            Depth writes are off and it draws first, so it can never occlude. */}
        <mesh renderOrder={-1000} frustumCulled={false} raycast={NEVER_HIT}>
          <sphereGeometry args={[SKY_RADIUS_M, 32, 20]} />
          <shaderMaterial
            side={BackSide}
            depthWrite={false}
            uniforms={skyUniforms}
            vertexShader={SKY_VERTEX_SHADER}
            fragmentShader={SKY_FRAGMENT_SHADER}
          />
        </mesh>

        {/* Sun, glow and stars are all `fog={false}`: they sit past the far
            end of the fog, which would otherwise dissolve them into the
            horizon colour and leave an empty sky. */}
        <points ref={stars} frustumCulled={false} raycast={NEVER_HIT}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[STAR_POSITIONS, 3]}
            />
          </bufferGeometry>
          <pointsMaterial
            ref={starMaterial}
            color="#eef2ff"
            size={1.7}
            sizeAttenuation={false}
            transparent
            depthWrite={false}
            toneMapped={false}
            fog={false}
            opacity={0}
          />
        </points>

        <mesh ref={sun} frustumCulled={false} raycast={NEVER_HIT}>
          <sphereGeometry args={[26, 24, 16]} />
          <meshBasicMaterial ref={sunMaterial} toneMapped={false} fog={false} />
          <mesh raycast={NEVER_HIT}>
            <sphereGeometry args={[70, 24, 16]} />
            <meshBasicMaterial
              ref={glowMaterial}
              transparent
              opacity={0.3}
              depthWrite={false}
              blending={AdditiveBlending}
              toneMapped={false}
              fog={false}
            />
          </mesh>
        </mesh>
      </group>

      <Ground onGroundClick={onGroundClick} />
      <City facadeMaterial={facade.material} />
    </>
  )
}
