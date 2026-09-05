/**
 * Rotating a camera rig about an arbitrary pivot.
 *
 * The property this exists for: rotating a camera rigidly about a point P
 * leaves P at the same coordinates in camera space, so P stays on the same
 * pixel. That is what makes "orbit around what the cursor is over" feel right
 * — the thing you are pointing at does not move, the world turns around it.
 *
 * `target` is rotated by the same quaternion as `position` because the two are
 * points of one rigid body. Keeping that true is what lets OrbitControls carry
 * on owning pan, dolly and damping: it re-derives its spherical state from
 * `position - target` on every update, and a rig that stayed rigid gives it
 * exactly what it expects.
 *
 * Both vectors are mutated in place, three.js style, because this runs on
 * every pointermove and a drag that allocates per frame is a drag that stutters.
 */

import { Quaternion, Vector3 } from 'three'

const WORLD_UP = new Vector3(0, 1, 0)

/** Radians per drag of one canvas height. Matches OrbitControls' rotateSpeed 1. */
export const ROTATE_RADIANS_PER_HEIGHT = 2 * Math.PI

/** Keeps the pitch axis off the pole, where its cross product vanishes. */
export const MIN_POLAR_RAD = 0.05

// Module-level scratch. Single-threaded, and never live across a call.
const offset = new Vector3()
const axis = new Vector3()
const yaw = new Quaternion()
const pitch = new Quaternion()
const rotation = new Quaternion()

export interface OrbitDrag {
  /** Pointer movement in CSS pixels since the last move event. */
  dx: number
  dy: number
  /** Canvas height in CSS pixels; one height of drag is one full turn. */
  height: number
  minPolarAngle: number
  maxPolarAngle: number
}

/**
 * Rotate `position` and `target` about `pivot`, in place.
 *
 * Pitch is clamped against the polar limits of the *offset* rather than of the
 * camera about the pivot, because the offset is the difference of two points
 * rotating by the same quaternion and therefore rotates by that quaternion
 * exactly — whatever the pivot is. So the clamp is measured on the real
 * post-rotation angle and the camera cannot be walked underground.
 */
export function rotateAboutPivot(
  position: Vector3,
  target: Vector3,
  pivot: Vector3,
  drag: OrbitDrag,
): void {
  const { dx, dy, height, minPolarAngle, maxPolarAngle } = drag
  if ((dx === 0 && dy === 0) || height <= 0) return

  offset.copy(position).sub(target)
  const radius = offset.length()
  if (radius < 1e-6) return

  const polar = Math.acos(Math.min(1, Math.max(-1, offset.y / radius)))
  const minPolar = Math.max(minPolarAngle, MIN_POLAR_RAD)
  const maxPolar = Math.min(maxPolarAngle, Math.PI - MIN_POLAR_RAD)
  const pitchAngle = Math.min(
    maxPolar - polar,
    Math.max(minPolar - polar, (-ROTATE_RADIANS_PER_HEIGHT * dy) / height),
  )

  const axisLength = axis.crossVectors(WORLD_UP, offset).length()
  if (axisLength > 1e-6) {
    pitch.setFromAxisAngle(axis.divideScalar(axisLength), pitchAngle)
  } else {
    pitch.identity()
  }
  // Yaw about world +Y, never about the camera's own up, so the horizon
  // cannot tilt however long the drag goes on.
  yaw.setFromAxisAngle(WORLD_UP, (-ROTATE_RADIANS_PER_HEIGHT * dx) / height)
  rotation.multiplyQuaternions(yaw, pitch)

  position.sub(pivot).applyQuaternion(rotation).add(pivot)
  target.sub(pivot).applyQuaternion(rotation).add(pivot)
}
