/**
 * The leash on the camera.
 *
 * The property that matters is the one a broken constant would violate
 * silently: **"Frame view" must always be inside the leash**. A ceiling
 * tighter than the framing distance would show a student a button that snaps
 * the camera somewhere the camera is then dragged back out of, once per frame,
 * forever. So the sweep below runs every design the controls can express and
 * asserts the two never cross.
 *
 * The rest is the promise the module makes to `Viewport`: a point already
 * inside gets a zero correction (so the leash costs nothing while it is not
 * being used), and a point outside comes back to the boundary rather than to
 * the middle.
 */

import { describe, expect, it } from 'vitest'
import {
  PLAN_WIDTH_LIMITS_M,
  STOREY_COUNT_LIMITS,
  STOREY_HEIGHT_LIMITS_M,
} from '@/lib/limits.ts'
import {
  CITY_HALF_EXTENT_M,
  cameraLift_m,
  framingDistance_m,
  framingRadius_m,
  orbitBounds,
  targetCorrection,
  type Dimensions,
} from './cameraBounds.ts'

/** The viewport's lens. Duplicated deliberately: a change there should fail here. */
const FOV_DEG = 34

const DEFAULT: Dimensions = {
  // The studio's opening design: six storeys at 3.5 m on an 18 x 12 m plan.
  totalHeight_m: 21,
  footprintRadius_m: Math.hypot(18, 12) / 2,
}

describe('framing', () => {
  it('never frames closer than the minimum radius, however small the design', () => {
    const shed: Dimensions = { totalHeight_m: 2, footprintRadius_m: 2.2 }
    expect(framingRadius_m(shed)).toBe(6)
  })

  it('grows with the taller of height and plan', () => {
    const tall = framingDistance_m(
      { totalHeight_m: 80, footprintRadius_m: 10 },
      FOV_DEG,
    )
    const wide = framingDistance_m(
      { totalHeight_m: 10, footprintRadius_m: 80 },
      FOV_DEG,
    )
    // Half the height against the whole plan radius: a 160 m tower and an 80 m
    // wide shed need the same distance.
    expect(framingDistance_m({ totalHeight_m: 160, footprintRadius_m: 10 }, FOV_DEG))
      .toBeCloseTo(wide, 6)
    expect(tall).toBeLessThan(wide)
  })
})

describe('the zoom-out ceiling', () => {
  it('leaves the default design room to see its own street', () => {
    const bounds = orbitBounds(DEFAULT, FOV_DEG)
    // Two thirds of a block pitch at least: far enough that the neighbours,
    // the road and the parked cars are all in frame.
    expect(bounds.maxDistance_m).toBeGreaterThan(90)
  })

  it('never lets the camera out past the city', () => {
    const bounds = orbitBounds(
      { totalHeight_m: 192, footprintRadius_m: 42.5 },
      FOV_DEG,
    )
    expect(bounds.maxDistance_m).toBeLessThanOrEqual(CITY_HALF_EXTENT_M * 1.6)
  })

  it('is far tighter than the 600 m it replaced, for an ordinary design', () => {
    // The point of the change. A constant sized for the largest design the
    // controls allow is an empty sky over every other one.
    expect(orbitBounds(DEFAULT, FOV_DEG).maxDistance_m).toBeLessThan(200)
  })

  // The invariant. Every design the sliders can reach, framed and then leashed.
  it('always contains the distance Frame view puts the camera at', () => {
    for (let count = STOREY_COUNT_LIMITS.min; count <= STOREY_COUNT_LIMITS.max; count++) {
      for (const height_m of [STOREY_HEIGHT_LIMITS_M.min, 3.5, STOREY_HEIGHT_LIMITS_M.max]) {
        for (const width_m of [PLAN_WIDTH_LIMITS_M.min, 18, PLAN_WIDTH_LIMITS_M.max]) {
          const dimensions: Dimensions = {
            totalHeight_m: count * height_m,
            footprintRadius_m: Math.hypot(width_m, width_m) / 2,
          }
          const bounds = orbitBounds(dimensions, FOV_DEG)
          expect(framingDistance_m(dimensions, FOV_DEG)).toBeLessThanOrEqual(
            bounds.maxDistance_m,
          )
          expect(bounds.minDistance_m).toBeLessThan(bounds.maxDistance_m)
        }
      }
    }
  })
})

describe('the target correction', () => {
  const bounds = orbitBounds(DEFAULT, FOV_DEG)

  it('is nothing at all for a target that is already inside', () => {
    expect(targetCorrection({ x: 3, y: 10, z: -4 }, bounds)).toEqual({
      x: 0,
      y: 0,
      z: 0,
    })
  })

  it('brings a runaway pan back to the edge, not to the centre', () => {
    const target = { x: 900, y: 10, z: 0 }
    const fix = targetCorrection(target, bounds)
    expect(target.x + fix.x).toBeCloseTo(bounds.targetRadius_m, 6)
    expect(fix.y).toBe(0)
  })

  it('keeps the bearing it was panned to', () => {
    // Pulled straight back along the radius: the direction from the site to
    // the target is unchanged, so hitting the edge slides rather than swings.
    const target = { x: 600, y: 5, z: 600 }
    const fix = targetCorrection(target, bounds)
    const after = { x: target.x + fix.x, z: target.z + fix.z }
    expect(after.x).toBeCloseTo(after.z, 6)
    expect(Math.hypot(after.x, after.z)).toBeCloseTo(bounds.targetRadius_m, 6)
  })

  it('will not let the pivot sink into the ground or float off the roof', () => {
    expect(targetCorrection({ x: 0, y: -40, z: 0 }, bounds).y).toBe(40)
    const above = targetCorrection({ x: 0, y: 500, z: 0 }, bounds)
    expect(500 + above.y).toBe(bounds.maxTargetHeight_m)
  })
})

describe('the camera lift', () => {
  const bounds = orbitBounds(DEFAULT, FOV_DEG)

  it('is a floor, not a rail — a high camera is left alone', () => {
    expect(cameraLift_m(400, bounds)).toBe(0)
  })

  it('raises a camera that has been panned underground', () => {
    expect(cameraLift_m(-3, bounds)).toBe(bounds.minCameraHeight_m + 3)
  })
})
