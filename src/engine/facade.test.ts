/**
 * The envelope, from the attacker's side of the same question the rest of the
 * engine tests ask: could a facade change a number it has no business
 * changing, or fail to change one it does?
 *
 * The four claims the feature rests on:
 *   1. `exposed` is exactly free — carbon, cost and weight all unchanged.
 *   2. Carbon and cost scale with external wall area, not floor area.
 *   3. A facade's weight reaches the stability check, so a heavy skin makes a
 *      tower harder to tip over and a light one makes it easier.
 *   4. Nothing a facade does touches stiffness, drift or wind load.
 * (4) is the one worth guarding hardest: it is the assumption a future change
 * is most likely to break by accident.
 */

import { describe, expect, it } from 'vitest'
import { analyze } from './analyze.ts'
import { FACADE, FACADE_SYSTEMS } from './constants.ts'
import { MATERIAL_LIBRARY } from './materials.ts'
import { facadeArea_m2, facadeQuantities } from './sustainability.ts'
import type { FacadeSystem, Storey, Structure, WindHazard } from './types.ts'

const storey = (facade: FacadeSystem): Storey => ({
  height_m: 3.5,
  widthX_m: 18,
  widthY_m: 12,
  materialId: 'reinforced-concrete',
  lateralSystem: 'shear-wall',
  facade,
})

const tower = (facade: FacadeSystem, storeys = 6): Structure => ({
  storeys: Array.from({ length: storeys }, () => storey(facade)),
  foundation: { type: 'raft', embedmentDepth_m: 1.5, anchorCapacity_kN: 400 },
  exposureCategory: 'C',
})

const hazard: WindHazard = {
  kind: 'wind',
  gustSpeed_kmh: 150,
  directionDeg: 0,
  terrainRoughness: 0.02,
}

const run = (facade: FacadeSystem, storeys = 6) =>
  analyze(tower(facade, storeys), hazard, MATERIAL_LIBRARY)

describe('facade area', () => {
  it('is the perimeter times the height, with no roof', () => {
    // 2 * (18 + 12) * 3.5 = 210
    expect(facadeArea_m2(storey('punched'))).toBeCloseTo(210, 10)
  })

  it('grows with perimeter, not with floor area', () => {
    // 20 x 20 and 40 x 10 enclose the same 400 m2 of floor; the second has a
    // 25% longer perimeter and so needs 25% more cladding.
    const square = facadeArea_m2({ ...storey('punched'), widthX_m: 20, widthY_m: 20 })
    const slab = facadeArea_m2({ ...storey('punched'), widthX_m: 40, widthY_m: 10 })
    expect(slab / square).toBeCloseTo(1.25, 10)
  })
})

describe('exposed is the zero case', () => {
  it('adds no carbon, no cost and no weight', () => {
    const quantities = facadeQuantities(storey('exposed'))
    expect(quantities.embodiedCarbon_kgCO2e).toBe(0)
    expect(quantities.cost_usd).toBe(0)
    expect(quantities.selfWeight_kN).toBe(0)
  })

  it('leaves the storey totals equal to the frame alone', () => {
    for (const result of run('exposed').storeys) {
      expect(result.facadeCarbon_kgCO2e).toBe(0)
      expect(result.facadeCost_usd).toBe(0)
      expect(result.facadeWeight_kN).toBe(0)
      // Area is still reported: the wall exists, it just has nothing on it.
      expect(result.facadeArea_m2).toBeGreaterThan(0)
    }
  })
})

describe('carbon and cost', () => {
  it('rises with every facade over the bare frame', () => {
    const bare = run('exposed').scoreCard
    for (const facade of FACADE_SYSTEMS.filter((f) => f !== 'exposed')) {
      const clad = run(facade).scoreCard
      expect(clad.carbonKg).toBeGreaterThan(bare.carbonKg)
      expect(clad.costUsd).toBeGreaterThan(bare.costUsd)
    }
  })

  it('reports a split that adds back up to the total', () => {
    for (const result of run('curtain-wall').storeys) {
      const frameCarbon = result.embodiedCarbon_kgCO2e - result.facadeCarbon_kgCO2e
      const frameCost = result.cost_usd - result.facadeCost_usd
      expect(frameCarbon).toBeGreaterThan(0)
      expect(frameCost).toBeGreaterThan(0)
      expect(result.facadeCarbon_kgCO2e).toBeCloseTo(
        result.facadeArea_m2 * FACADE['curtain-wall'].embodiedCarbon_kgCO2e_m2,
        9,
      )
    }
  })

  it('costs more per square metre of wall for more glass', () => {
    // The ordering the archetypes claim: more glazing, more money.
    const ordered: readonly FacadeSystem[] = ['exposed', 'punched', 'ribbon', 'curtain-wall']
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = ordered[i - 1]
      const current = ordered[i]
      if (previous === undefined || current === undefined) throw new Error('bad table')
      expect(FACADE[current].windowToWallRatio).toBeGreaterThan(
        FACADE[previous].windowToWallRatio,
      )
      expect(FACADE[current].cost_usd_m2).toBeGreaterThan(FACADE[previous].cost_usd_m2)
    }
  })
})

describe('weight reaches the stability check', () => {
  it('makes a heavy skin harder to tip over than a light one', () => {
    const heavy = run('punched').stability
    const light = run('curtain-wall').stability

    expect(heavy.totalSelfWeight_kN).toBeGreaterThan(light.totalSelfWeight_kN)
    expect(heavy.factorOfSafetyOverturning).toBeGreaterThan(
      light.factorOfSafetyOverturning,
    )
    // Friction is proportional to weight, so sliding moves the same way.
    expect(heavy.factorOfSafetySliding).toBeGreaterThan(light.factorOfSafetySliding)
  })

  it('gives the bare frame the least resistance of all', () => {
    const bare = run('exposed').stability
    for (const facade of FACADE_SYSTEMS.filter((f) => f !== 'exposed')) {
      expect(run(facade).stability.factorOfSafetyOverturning).toBeGreaterThan(
        bare.factorOfSafetyOverturning,
      )
    }
  })
})

describe('the facade is not structure', () => {
  it('changes no stiffness, no drift and no wind load', () => {
    const bare = run('exposed')
    for (const facade of FACADE_SYSTEMS) {
      const clad = run(facade)
      clad.storeys.forEach((result, i) => {
        const reference = bare.storeys[i]
        if (reference === undefined) throw new Error('storey count mismatch')
        expect(result.stiffness_kN_per_m).toBe(reference.stiffness_kN_per_m)
        expect(result.driftRatio).toBe(reference.driftRatio)
        expect(result.lateralForce_kN).toBe(reference.lateralForce_kN)
        expect(result.storeyShear_kN).toBe(reference.storeyShear_kN)
        expect(result.projectedArea_m2).toBe(reference.projectedArea_m2)
      })
      expect(clad.stability.baseShear_kN).toBe(bare.stability.baseShear_kN)
      expect(clad.stability.overturningMoment_kNm).toBe(
        bare.stability.overturningMoment_kNm,
      )
    }
  })

  it('says so out loud whenever a design has windows in it', () => {
    expect(run('curtain-wall').warnings.join(' ')).toMatch(/non-structural/i)
    expect(run('exposed').warnings.join(' ')).not.toMatch(/non-structural/i)
  })

  it('flags the archetype data as an estimate whenever it is used', () => {
    expect(run('punched').warnings.join(' ')).toMatch(/archetype rates/i)
    expect(run('exposed').warnings.join(' ')).not.toMatch(/archetype rates/i)
  })
})

describe('determinism', () => {
  it('gives byte-identical numbers for the same facade twice', () => {
    expect(run('ribbon')).toEqual(run('ribbon'))
  })
})
