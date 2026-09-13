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
 * `StoreyStack` and `HazardArrows`, still straight off the engine, and are still
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

import { memo, useMemo, useRef, type RefObject } from 'react'
import { Instance, Instances, type PositionMesh } from '@react-three/drei'
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
import { skyPalette, sunDirection } from '@/lib/sky.ts'
import { createWindowedMaterial, type WindowedMaterial } from './windows.ts'
import {
  BLANK_NEIGHBOURS,
  CARS,
  DASHES,
  DASH_LENGTH_M,
  GLAZED_NEIGHBOURS,
  GROUND_EXTENT_M,
  PAVEMENT_TOP_M,
  PEDESTRIANS,
  ROAD_CENTRES_M,
  ROAD_HALF_M,
  ROAD_LENGTH_M,
  SIDEWALK_SLABS,
  SITE_PAD_HALF_M,
  STAR_DIRECTIONS,
  TREES,
  walkOffset_m,
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
 * How much of a neighbour's wall is glass. A fixed, middling figure: these are
 * background buildings and nobody chose their facades, so they get one that
 * reads as "office block" and stays out of the way.
 */
const NEIGHBOUR_WINDOW_RATIO = 0.34
const NEIGHBOUR_BAY_WIDTH_M = 3.2
const NEIGHBOUR_BAY_HEIGHT_M = 3.5
/** Fewer lights on than the student's own tower; it is late and this is a city. */
const NEIGHBOUR_LIT_FRACTION = 0.4
/**
 * Blank elevations get a plain material and no window shader at all. Rougher
 * than the glazed stock, because what this is standing in for — a warehouse
 * flank, a party wall, a depot — is render or blockwork rather than a curtain
 * wall.
 */
const BLANK_FACADE_ROUGHNESS = 0.95

/** Walkers. Roughly adult proportions at the scale the city is drawn. */
const WALKER_BODY_RADIUS_M = 0.19
const WALKER_BODY_LENGTH_M = 0.82
const WALKER_HEAD_RADIUS_M = 0.15
/** Centre height of the body capsule above the kerb. */
const WALKER_BODY_Y_M = 0.6
const WALKER_HEAD_Y_M = 1.16
/** Amplitude of the walk bob. Small: this is gait, not bouncing. */
const WALKER_BOB_M = 0.035
const WALKER_SKIN_HEX = '#c8a68c'

/**
 * The neighbourhood's facades. The same window shader the student's building
 * uses (`windows.ts`), on an instanced material — one home for what a window
 * looks like, so the tower and the block across the road are drawn by the
 * same code and read as the same kind of object.
 */
function useNeighbourMaterial(): WindowedMaterial {
  return useMemo(() => {
    const windowed = createWindowedMaterial(
      { roughness: 0.88, metalness: 0 },
      {
        instanced: true,
        bayWidth_m: NEIGHBOUR_BAY_WIDTH_M,
        bayHeight_m: NEIGHBOUR_BAY_HEIGHT_M,
        litFraction: NEIGHBOUR_LIT_FRACTION,
      },
    )
    windowed.setWindowToWallRatio(NEIGHBOUR_WINDOW_RATIO)
    return windowed
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
 *
 * "Click the ground to deselect" is bound to the four big surfaces one by one
 * rather than to the group around them. Anything carrying a pointer handler
 * joins r3f's interaction list, and that list is raycast *recursively* on every
 * pointermove to work out what is hovered — one handler on the group would put
 * five hundred kerb slabs and lane dashes through a ray test every time the
 * mouse twitched, to answer a question only the ground under them can answer.
 */
const Ground = memo(function Ground({
  onGroundClick,
}: {
  onGroundClick: () => void
}) {
  return (
    <group>
      {/* Open ground. Everything else is laid on top of it. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow onClick={onGroundClick}>
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
          onClick={onGroundClick}
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
          onClick={onGroundClick}
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow onClick={onGroundClick}>
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
      {/* Glazed stock: the window shader, shared with the student's tower. */}
      <Instances
        limit={Math.max(1, GLAZED_NEIGHBOURS.length)}
        frames={4}
        material={facadeMaterial}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        {GLAZED_NEIGHBOURS.map((building, index) => (
          <Instance
            key={index}
            position={[building.x, building.height_m / 2, building.z]}
            scale={[building.widthX_m, building.height_m, building.widthZ_m]}
            color={building.color}
          />
        ))}
      </Instances>

      {/* Blank elevations. A separate draw with a plain material rather than
          the same one at zero glazing: a windowless wall should not be paying
          for a window shader, and this way it also keeps its own roughness. */}
      <Instances
        limit={Math.max(1, BLANK_NEIGHBOURS.length)}
        frames={4}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color="#ffffff"
          roughness={BLANK_FACADE_ROUGHNESS}
          metalness={0}
        />
        {BLANK_NEIGHBOURS.map((building, index) => (
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

/**
 * The crowd.
 *
 * The only thing in the scenery that moves, and the exception is deliberate:
 * everything else is frozen because a neighbourhood that rearranged itself
 * under a slider would look like output, but a wholly still city reads as a
 * *model* of a city. People walking are the cheapest way to say that the tower
 * is going up somewhere real.
 *
 * They are still scenery, and obey the same rule as the rest of it: no walker
 * reads an `AnalysisResult` and none feeds one. The crowd is identical whether
 * the design stands or falls over — only the clock moves it.
 *
 * Positions are written straight onto the instances in `useFrame` rather than
 * held in React state, for the obvious reason: sixty-four walkers at sixty
 * hertz is not something to re-render a component tree for.
 */
const Pedestrians = memo(function Pedestrians() {
  const bodies = useRef<(PositionMesh | null)[]>([])
  const heads = useRef<(PositionMesh | null)[]>([])

  useFrame((state) => {
    const seconds = state.clock.elapsedTime
    for (let index = 0; index < PEDESTRIANS.length; index += 1) {
      const walker = PEDESTRIANS[index]
      const body = bodies.current[index]
      const head = heads.current[index]
      if (walker === undefined || !body || !head) continue

      const along = walkOffset_m(walker, seconds)
      // `abs(sin)` rather than `sin`: a gait rises twice per stride, once on
      // each foot, and the doubled frequency is what stops it reading as a
      // float up and down.
      const bob =
        Math.abs(Math.sin(seconds * walker.speed_m_s * 2.6 + walker.phase)) *
        WALKER_BOB_M *
        walker.scale
      const base = PAVEMENT_TOP_M + bob

      const x = walker.axis === 0 ? along : walker.across_m
      const z = walker.axis === 0 ? walker.across_m : along

      body.position.set(x, base + WALKER_BODY_Y_M * walker.scale, z)
      head.position.set(x, base + WALKER_HEAD_Y_M * walker.scale, z)
    }
  })

  return (
    <group>
      {/* `frustumCulled={false}` on both: an InstancedMesh's bounding volume
          is computed from the matrices it had when it was built, and these
          move, so the whole crowd would vanish as soon as that stale box left
          the view. */}
      <Instances
        limit={Math.max(1, PEDESTRIANS.length)}
        frustumCulled={false}
        castShadow
      >
        <capsuleGeometry
          args={[WALKER_BODY_RADIUS_M, WALKER_BODY_LENGTH_M, 4, 8]}
        />
        <meshStandardMaterial color="#ffffff" roughness={0.85} />
        {PEDESTRIANS.map((walker, index) => (
          <Instance
            key={index}
            ref={(instance: PositionMesh | null) => {
              bodies.current[index] = instance
            }}
            scale={walker.scale}
            color={walker.coat}
          />
        ))}
      </Instances>

      <Instances
        limit={Math.max(1, PEDESTRIANS.length)}
        frustumCulled={false}
        castShadow
      >
        <sphereGeometry args={[WALKER_HEAD_RADIUS_M, 8, 6]} />
        <meshStandardMaterial color={WALKER_SKIN_HEX} roughness={0.9} />
        {PEDESTRIANS.map((walker, index) => (
          <Instance
            key={index}
            ref={(instance: PositionMesh | null) => {
              heads.current[index] = instance
            }}
            scale={walker.scale}
          />
        ))}
      </Instances>
    </group>
  )
})

export interface WorldProps {
  /** Eased 0..1 time of day, from `useNightProgress`. */
  night: RefObject<number>
  onGroundClick: () => void
}

export function World({ night, onGroundClick }: WorldProps) {
  const facade = useNeighbourMaterial()

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

  useFrame((state) => {
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

    facade.setNight(palette.windowGlow)
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
      <Pedestrians />
    </>
  )
}
