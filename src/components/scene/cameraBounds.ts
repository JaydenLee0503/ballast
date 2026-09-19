/**
 * How far the camera may get from the design, and how far the view may be
 * panned off it. Pure, so the claims can be stated as tests.
 *
 * The scene is a city, not an infinite world. `scenery.ts` lays out a fixed
 * five-by-five grid of blocks on a ground plane that runs out into fog, and
 * past the last street there is nothing to look at: a flat disc under a
 * gradient, with the building too small to read. That is the state this module
 * exists to make unreachable.
 *
 * Two halves, because there are two ways out of the city.
 *
 * - **Dolly.** `maxDistance_m` used to be a constant 600 m, which is barely
 *   enough to frame the tallest thing the controls can express and about
 *   fourteen storeys of empty sky over a bungalow. A limit on how far back you
 *   can get is only meaningful relative to the thing you are backing away
 *   from, so it is derived from the design's own framing distance — the one
 *   `CameraRig` uses — and then capped by the size of the city.
 * - **Pan.** `zoomToCursor` dollies toward whatever is under the pointer, so a
 *   few scrolls aimed at the horizon walk the orbit target out past the last
 *   block, and nothing but "Frame view" brings it back. So the target is held
 *   inside a cylinder over the site and a height band above the ground.
 *   Panning is for looking round the building, not for leaving it.
 *
 * Both corrections are returned as **translations**, and the caller applies
 * each one to the camera and the target together. Two points of one rigid
 * body, moved by the same vector, keep the view pointing exactly where it
 * pointed — the same trick `lib/orbit.ts` uses for rotation, and the reason
 * hitting the limit reads as the view stopping rather than as it lurching.
 */

import {
  BLOCK_HALF_M,
  BLOCK_PITCH_M,
  BLOCK_RANGE,
  SIDEWALK_M,
  SITE_PAD_HALF_M,
} from './scenery.ts'

/** The design, as the camera cares about it: how tall, and how wide across. */
export interface Dimensions {
  readonly totalHeight_m: number
  /** Half the plan diagonal of the widest storey. */
  readonly footprintRadius_m: number
}

/**
 * Floor under the framing sphere. A single 2 m storey on a 4 m plan is a
 * 2.2 m radius, and a camera framed that tightly is inside the front door.
 */
const MIN_FRAMING_RADIUS_M = 6

/** Slack around the framing sphere, so the building is not edge to edge. */
const FRAMING_MARGIN = 1.2

/**
 * How much further back than "the whole building fills the frame" the camera
 * may go, as a multiple.
 *
 * Calibrated rather than cited: at 3x the framing distance the studio's
 * default six-storey block sits in the middle of its own plot with the
 * surrounding streets, the neighbouring blocks and the skyline all in view,
 * which is as much context as the scenery has to give. Past that the building
 * is a speck and the extra pixels are ground plane.
 */
const ZOOM_OUT_HEADROOM = 3

/**
 * Half the width of the built city: the outermost block's far pavement.
 * Derived from the scenery's own layout rather than restated, so adding a ring
 * of blocks widens the leash by exactly as much.
 */
export const CITY_HALF_EXTENT_M =
  BLOCK_RANGE * BLOCK_PITCH_M + BLOCK_HALF_M + SIDEWALK_M

/**
 * The hard ceiling on dolly, whatever the design. 1.6x the city's half width
 * puts the far pavement comfortably inside the frame and the fog (which closes
 * from 220 m, see `World.tsx`) over everything past it.
 */
const MAX_ORBIT_DISTANCE_M = CITY_HALF_EXTENT_M * 1.6

/**
 * The floor on that ceiling. Without it a one-storey shed would be leashed at
 * 74 m, which is close enough that the student never sees they are standing in
 * a street. 90 m is a little over two thirds of a block pitch.
 */
const MIN_ZOOM_OUT_M = 90

/** Closest approach. Past this the near plane starts clipping the facade. */
const MIN_ORBIT_DISTANCE_M = 5

/** Camera eye height floor, so panning cannot drop the view underground. */
const MIN_CAMERA_HEIGHT_M = 2

/** Headroom above the roof the target may be raised to, for looking at sky. */
const TARGET_HEADROOM_M = 12

/** The sphere the camera has to fit in view to show the whole design. */
export function framingRadius_m(dimensions: Dimensions): number {
  return Math.max(
    dimensions.footprintRadius_m,
    dimensions.totalHeight_m / 2,
    MIN_FRAMING_RADIUS_M,
  )
}

/**
 * Distance at which a sphere of `framingRadius_m` fills the vertical field of
 * view, with `FRAMING_MARGIN` to spare: d = r / sin(fov / 2).
 */
export function framingDistance_m(
  dimensions: Dimensions,
  fovDeg: number,
): number {
  const halfFov = ((fovDeg / 2) * Math.PI) / 180
  return (framingRadius_m(dimensions) / Math.sin(halfFov)) * FRAMING_MARGIN
}

export interface OrbitBounds {
  readonly minDistance_m: number
  readonly maxDistance_m: number
  /** How far the target may sit from the site centre, horizontally. */
  readonly targetRadius_m: number
  readonly minTargetHeight_m: number
  readonly maxTargetHeight_m: number
  readonly minCameraHeight_m: number
}

export function orbitBounds(
  dimensions: Dimensions,
  fovDeg: number,
): OrbitBounds {
  const framing = framingDistance_m(dimensions, fovDeg)
  return {
    minDistance_m: MIN_ORBIT_DISTANCE_M,
    maxDistance_m: Math.min(
      MAX_ORBIT_DISTANCE_M,
      Math.max(MIN_ZOOM_OUT_M, framing * ZOOM_OUT_HEADROOM),
    ),
    // The prepared pad plus the framing sphere: enough to walk the pivot from
    // one corner of the plot to the other and no further.
    targetRadius_m: SITE_PAD_HALF_M + framingRadius_m(dimensions),
    minTargetHeight_m: 0,
    maxTargetHeight_m: dimensions.totalHeight_m + TARGET_HEADROOM_M,
    minCameraHeight_m: MIN_CAMERA_HEIGHT_M,
  }
}

/** A point, structurally — `THREE.Vector3` satisfies it without importing it. */
export interface Point3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

/**
 * The translation that brings `target` back inside `bounds`. All three
 * components are 0 when the target is already inside, which is the common
 * case and the one the caller skips on.
 */
export function targetCorrection(
  target: Point3,
  bounds: OrbitBounds,
): { x: number; y: number; z: number } {
  const radius = Math.hypot(target.x, target.z)
  // Pulled straight back along the radius, so a pan that runs into the edge
  // slides along it instead of being flung toward the centre.
  const scale = radius > bounds.targetRadius_m ? bounds.targetRadius_m / radius : 1
  const y = Math.min(
    bounds.maxTargetHeight_m,
    Math.max(bounds.minTargetHeight_m, target.y),
  )
  return {
    x: target.x * scale - target.x,
    y: y - target.y,
    z: target.z * scale - target.z,
  }
}

/**
 * How far the whole rig has to be lifted to keep the camera above ground.
 * Never negative: this is a floor, not a rail — the camera is free to be as
 * high as the orbit puts it.
 */
export function cameraLift_m(cameraY: number, bounds: OrbitBounds): number {
  return Math.max(0, bounds.minCameraHeight_m - cameraY)
}
