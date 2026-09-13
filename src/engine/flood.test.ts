/**
 * The flood branch.
 *
 * HAND-WORKED CASE. One 4 m storey on a 10 x 10 m plan, standing in 4 m of
 * still water, flow along +X so the loaded face is the 10 m widthY:
 *
 *   a = d - base = 4 m,  b = d - top = 0
 *   F = gamma_w * (a^2 - b^2)/2 * B = 9.81 * 8 * 10        = 784.8 kN
 *   M = gamma_w * [d(a^2-b^2)/2 - (a^3-b^3)/3] * B
 *     = 9.81 * (32 - 21.333) * 10                          = 1046.4 kNm
 *   centroid = M/F = 1.333 m                               = d/3, as the
 *                                                            textbook says
 *   buoyancy = gamma_w * A * d * fraction
 *            = 9.81 * 100 * 4 * 0.85                        = 3335.4 kN
 *
 * The d/3 result is the one worth having: it falls out of the closed-form
 * integral rather than being asserted, so a mistake in either term shows up.
 */

import { describe, expect, it } from 'vitest'
import {
  analyze,
  floodDragCoefficient,
  flotationSafetyFactor,
  MATERIAL_LIBRARY,
  obstructedWidth_m,
  storeyFloodLoad,
  WATER_UNIT_WEIGHT_KN_M3,
  type FloodHazard,
  type Storey,
  type Structure,
} from './index.ts'

const SQUARE: Storey = {
  height_m: 4,
  widthX_m: 10,
  widthY_m: 10,
  planShape: 'rectangle',
  materialId: 'cross-laminated-timber',
  lateralSystem: 'shear-wall',
  facade: 'punched',
}

const STILL: FloodHazard = {
  kind: 'flood',
  depth_m: 4,
  velocity_ms: 0,
  directionDeg: 0,
}

function building(storeys: Storey[]): Structure {
  return {
    typology: 'custom',
    storeys,
    foundation: { type: 'raft', embedmentDepth_m: 1.5, anchorCapacity_kN: 600 },
    exposureCategory: 'C',
  }
}

describe('the hand-worked case', () => {
  const load = storeyFloodLoad(SQUARE, 0, STILL, 10)

  it('integrates the hydrostatic pressure over the submerged wall', () => {
    expect(load.lateralForce_kN).toBeCloseTo(784.8, 1)
  })

  it('puts the resultant at one third of the depth', () => {
    expect(load.loadElevation_m).toBeCloseTo(4 / 3, 6)
  })

  it('displaces its own submerged volume of water', () => {
    expect(load.buoyancy_kN).toBeCloseTo(3335.4, 1)
  })

  it('reports the submerged face it loaded', () => {
    expect(load.submergedDepth_m).toBeCloseTo(4, 6)
    expect(load.projectedArea_m2).toBeCloseTo(40, 6)
  })
})

describe('partial submersion', () => {
  it('loads nothing above the surface', () => {
    const dry = storeyFloodLoad(SQUARE, 4, STILL, 10)
    expect(dry.lateralForce_kN).toBe(0)
    expect(dry.buoyancy_kN).toBe(0)
    expect(dry.submergedDepth_m).toBe(0)
  })

  it('puts the resultant low in the storey the surface passes through', () => {
    // Water at 2 m in a 4 m storey: the pressure is triangular over the lower
    // half, so the resultant sits at 2/3 m, not at the storey's 2 m mid-height.
    const half = storeyFloodLoad(SQUARE, 0, { ...STILL, depth_m: 2 }, 10)
    expect(half.loadElevation_m).toBeCloseTo(2 / 3, 6)
    expect(half.loadElevation_m).toBeLessThan(SQUARE.height_m / 2)
  })

  it('grows with the square of depth', () => {
    const one = storeyFloodLoad(SQUARE, 0, { ...STILL, depth_m: 1 }, 10)
    const two = storeyFloodLoad(SQUARE, 0, { ...STILL, depth_m: 2 }, 10)
    expect(two.lateralForce_kN / one.lateralForce_kN).toBeCloseTo(4, 6)
  })

  it('splits a two-storey wall the same way a one-storey wall of the same depth is loaded', () => {
    const whole = storeyFloodLoad({ ...SQUARE, height_m: 8 }, 0, { ...STILL, depth_m: 8 }, 10)
    const lower = storeyFloodLoad(SQUARE, 0, { ...STILL, depth_m: 8 }, 10)
    const upper = storeyFloodLoad(SQUARE, 4, { ...STILL, depth_m: 8 }, 10)
    expect(lower.lateralForce_kN + upper.lateralForce_kN).toBeCloseTo(
      whole.lateralForce_kN,
      6,
    )
  })
})

describe('flowing water', () => {
  it('adds drag on top of the standing pressure', () => {
    const still = storeyFloodLoad(SQUARE, 0, STILL, 10)
    const fast = storeyFloodLoad(SQUARE, 0, { ...STILL, velocity_ms: 3 }, 10)
    expect(fast.lateralForce_kN).toBeGreaterThan(still.lateralForce_kN)
  })

  it('scales drag with the square of velocity', () => {
    const still = storeyFloodLoad(SQUARE, 0, STILL, 10).lateralForce_kN
    const one = storeyFloodLoad(SQUARE, 0, { ...STILL, velocity_ms: 1 }, 10).lateralForce_kN
    const two = storeyFloodLoad(SQUARE, 0, { ...STILL, velocity_ms: 2 }, 10).lateralForce_kN
    expect((two - still) / (one - still)).toBeCloseTo(4, 6)
  })

  it('raises the resultant, because drag is uniform and pressure is not', () => {
    const still = storeyFloodLoad(SQUARE, 0, STILL, 10)
    const fast = storeyFloodLoad(SQUARE, 0, { ...STILL, velocity_ms: 4 }, 10)
    expect(fast.loadElevation_m).toBeGreaterThan(still.loadElevation_m)
    expect(fast.loadElevation_m).toBeLessThan(2)
  })

  it('reads a higher drag coefficient for a wider obstruction', () => {
    expect(floodDragCoefficient(120, 1)).toBeGreaterThan(floodDragCoefficient(10, 1))
    expect(floodDragCoefficient(10, 1)).toBeCloseTo(1.25, 6)
  })

  it('has no drag coefficient in no water', () => {
    expect(floodDragCoefficient(10, 0)).toBe(0)
  })
})

describe('the obstructed width follows the water, not the silhouette', () => {
  it('ignores storeys the flood never reaches', () => {
    const podium = { ...SQUARE, widthY_m: 40 }
    const tower = { ...SQUARE, widthY_m: 10 }
    const shallow = obstructedWidth_m([podium, tower], [0, 4], { ...STILL, depth_m: 2 })
    const deep = obstructedWidth_m([tower, podium], [0, 4], { ...STILL, depth_m: 2 })
    expect(shallow).toBeCloseTo(40, 6)
    expect(deep).toBeCloseTo(10, 6)
  })
})

describe('flotation', () => {
  it('is infinite in no water', () => {
    expect(flotationSafetyFactor(1000, 0, 0)).toBe(Number.POSITIVE_INFINITY)
  })

  it('counts the hold-downs, because that is what they are for', () => {
    expect(flotationSafetyFactor(500, 500, 1000)).toBeCloseTo(1, 6)
    expect(flotationSafetyFactor(500, 0, 1000)).toBeCloseTo(0.5, 6)
  })
})

describe('through analyze()', () => {
  const run = (structure: Structure, hazard: FloodHazard = STILL) =>
    analyze(structure, hazard, MATERIAL_LIBRARY)

  it('reports the hazard it was given', () => {
    expect(run(building([SQUARE])).hazardKind).toBe('flood')
  })

  it('loads the bottom of the building, where wind loads the top', () => {
    const tall = building(Array.from({ length: 6 }, () => ({ ...SQUARE, height_m: 3.5 })))
    const flood = run(tall, { ...STILL, depth_m: 4 })
    const forces = flood.storeys.map((s) => s.lateralForce_kN)
    expect(forces[0] as number).toBeGreaterThan(0)
    // Above the water line there is nothing at all.
    expect(forces[3]).toBe(0)
    expect(forces[5]).toBe(0)
  })

  it('subtracts buoyancy from the weight that resists sliding', () => {
    const dry = run(building([SQUARE]), { ...STILL, depth_m: 0 })
    const wet = run(building([SQUARE]), { ...STILL, depth_m: 3 })
    expect(dry.stability.slidingResistanceFriction_kN).toBeGreaterThan(
      wet.stability.slidingResistanceFriction_kN,
    )
  })

  it('reports flotation as its own check, and only for a flood', () => {
    const wet = run(building([SQUARE]))
    expect(wet.stability.factorOfSafetyFlotation).toBeDefined()
    expect(wet.stability.buoyancy_kN).toBeGreaterThan(0)

    const windy = analyze(
      building([SQUARE]),
      { kind: 'wind', gustSpeed_kmh: 150, directionDeg: 0, terrainRoughness: 0.02 },
      MATERIAL_LIBRARY,
    )
    expect(windy.stability.factorOfSafetyFlotation).toBeUndefined()
  })

  it('floats a light building and holds a heavy one down', () => {
    const timber = run(building([{ ...SQUARE, facade: 'exposed' }]))
    const concrete = run(
      building([
        { ...SQUARE, materialId: 'reinforced-concrete', facade: 'punched' },
      ]),
    )
    expect(timber.scoreCard.governingFailureMode).toBe('flotation')
    expect(concrete.stability.factorOfSafetyFlotation as number).toBeGreaterThan(
      timber.stability.factorOfSafetyFlotation as number,
    )
  })

  it('is harmless at zero depth, with a finite result', () => {
    const dry = run(building([SQUARE]), { ...STILL, depth_m: 0, velocity_ms: 0 })
    expect(dry.stability.baseShear_kN).toBe(0)
    expect(dry.scoreCard.safetyFactor).toBe(Number.POSITIVE_INFINITY)
    expect(dry.scoreCard.governingFailureMode).toBe('none')
  })

  it('says out loud that it assumes a dry interior', () => {
    expect(run(building([SQUARE])).warnings.join(' ')).toMatch(/dry inside/)
  })

  it('says out loud that there are no waves in it', () => {
    expect(run(building([SQUARE])).warnings.join(' ')).toMatch(
      /breaking wave|storm surge/,
    )
  })

  it('uses fresh water, as stated', () => {
    expect(WATER_UNIT_WEIGHT_KN_M3).toBeCloseTo(9.81, 6)
  })
})
