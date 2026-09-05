/**
 * The first test is the whole reason this module exists: after rotating about
 * a pivot, the pivot must still project to the same pixel. Everything else in
 * the cursor-pivot feature is plumbing around that one property, and it is the
 * one thing that cannot be checked by looking at the code.
 *
 * A real PerspectiveCamera does the projecting, so this checks the actual
 * matrix maths three.js will run, not a restatement of it.
 */

import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { MIN_POLAR_RAD, rotateAboutPivot } from './orbit.ts'

const MAX_POLAR = Math.PI / 2 - 0.02

function rig() {
  const camera = new PerspectiveCamera(45, 16 / 9, 0.1, 2000)
  const position = new Vector3(34, 26, 38)
  const target = new Vector3(0, 10.5, 0)
  camera.position.copy(position)
  camera.lookAt(target)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  return { camera, position, target }
}

/** Where a world point lands on screen, in normalised device coordinates. */
function screenPosition(camera: PerspectiveCamera, point: Vector3) {
  return point.clone().project(camera)
}

function reaim(camera: PerspectiveCamera, position: Vector3, target: Vector3) {
  camera.position.copy(position)
  camera.lookAt(target)
  camera.updateMatrixWorld(true)
}

const drag = (dx: number, dy: number) => ({
  dx,
  dy,
  height: 800,
  minPolarAngle: 0,
  maxPolarAngle: MAX_POLAR,
})

describe('the pivot stays under the cursor', () => {
  it.each([
    ['off to one side', new Vector3(9, 4, 6)],
    ['high on the building', new Vector3(-6, 19, 5)],
    ['at the ground plane', new Vector3(12, 0, -9)],
    ['behind the target', new Vector3(-14, 3, -12)],
  ])('holds its pixel for a pivot %s', (_label, pivot) => {
    const { camera, position, target } = rig()
    const before = screenPosition(camera, pivot)

    rotateAboutPivot(position, target, pivot, drag(60, -35))
    reaim(camera, position, target)

    const after = screenPosition(camera, pivot)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('holds across a long drag applied one event at a time', () => {
    const { camera, position, target } = rig()
    const pivot = new Vector3(8, 14, -3)
    const before = screenPosition(camera, pivot)

    // 40 small moves, the way real pointermove events arrive. Error here would
    // accumulate rather than cancel, so this is the honest version of the test.
    for (let i = 0; i < 40; i += 1) {
      rotateAboutPivot(position, target, pivot, drag(4, -1))
      reaim(camera, position, target)
    }

    const after = screenPosition(camera, pivot)
    expect(after.x).toBeCloseTo(before.x, 5)
    expect(after.y).toBeCloseTo(before.y, 5)
  })
})

describe('rigidity', () => {
  it('keeps the camera the same distance from its target', () => {
    const { position, target } = rig()
    const before = position.distanceTo(target)
    rotateAboutPivot(position, target, new Vector3(7, 5, 2), drag(50, 20))
    expect(position.distanceTo(target)).toBeCloseTo(before, 9)
  })

  it('keeps the camera the same distance from the pivot', () => {
    const { position, target } = rig()
    const pivot = new Vector3(7, 5, 2)
    const before = position.distanceTo(pivot)
    rotateAboutPivot(position, target, pivot, drag(50, 20))
    expect(position.distanceTo(pivot)).toBeCloseTo(before, 9)
  })

  it('does nothing on a zero drag', () => {
    const { position, target } = rig()
    const before = position.clone()
    rotateAboutPivot(position, target, new Vector3(1, 2, 3), drag(0, 0))
    expect(position.equals(before)).toBe(true)
  })
})

describe('polar limits', () => {
  it('will not push the camera below the ground however hard you drag', () => {
    const { position, target } = rig()
    for (let i = 0; i < 50; i += 1) {
      rotateAboutPivot(position, target, new Vector3(0, 8, 0), drag(0, -400))
    }
    const offset = position.clone().sub(target)
    const polar = Math.acos(offset.y / offset.length())
    expect(polar).toBeLessThanOrEqual(MAX_POLAR + 1e-9)
    expect(position.y).toBeGreaterThan(target.y)
  })

  it('will not drag the camera over the top pole', () => {
    const { position, target } = rig()
    for (let i = 0; i < 50; i += 1) {
      rotateAboutPivot(position, target, new Vector3(0, 8, 0), drag(0, 400))
    }
    const offset = position.clone().sub(target)
    const polar = Math.acos(offset.y / offset.length())
    expect(polar).toBeGreaterThanOrEqual(MIN_POLAR_RAD - 1e-9)
  })
})

describe('direction', () => {
  it('matches OrbitControls: dragging right swings the camera the same way', () => {
    const { position, target } = rig()
    const azimuthBefore = Math.atan2(position.x - target.x, position.z - target.z)
    rotateAboutPivot(position, target, target.clone(), drag(80, 0))
    const azimuthAfter = Math.atan2(position.x - target.x, position.z - target.z)
    // OrbitControls decreases theta as the pointer moves right.
    expect(azimuthAfter).toBeLessThan(azimuthBefore)
  })

  it('matches OrbitControls: dragging down raises the camera', () => {
    const { position, target } = rig()
    const before = position.y
    rotateAboutPivot(position, target, target.clone(), drag(0, 60))
    expect(position.y).toBeGreaterThan(before)
  })
})
