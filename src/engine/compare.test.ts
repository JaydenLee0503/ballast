/**
 * The interesting cases are the degenerate ones. A safety factor is
 * legitimately infinite, a drift ratio is legitimately zero, and both turn up
 * the moment a student drags the gust slider to 0 — which is the first thing
 * anyone does. A comparison that divides by them and shows "Infinity%" would
 * be wrong on screen at the easiest input to reach.
 */

import { describe, expect, it } from 'vitest'
import { analyze } from './analyze.ts'
import { compareDesigns, metricDelta, type DesignSnapshot } from './compare.ts'
import { MATERIAL_LIBRARY } from './materials.ts'
import type { Structure, WindHazard } from './types.ts'

const HAZARD: WindHazard = {
  kind: 'wind',
  gustSpeed_kmh: 150,
  directionDeg: 0,
  terrainRoughness: 0.02,
}

function structure(overrides: Partial<Structure> = {}, storeyCount = 6): Structure {
  return {
    storeys: Array.from({ length: storeyCount }, () => ({
      height_m: 3.5,
      widthX_m: 18,
      widthY_m: 12,
      materialId: 'cross-laminated-timber',
      lateralSystem: 'shear-wall' as const,
    })),
    foundation: { type: 'raft', embedmentDepth_m: 1.5, anchorCapacity_kN: 600 },
    exposureCategory: 'C',
    ...overrides,
  }
}

function snapshot(s: Structure, hazard: WindHazard = HAZARD): DesignSnapshot {
  return { result: analyze(s, hazard, MATERIAL_LIBRARY), structure: s }
}

describe('metricDelta', () => {
  it('reports no change as same, with a zero difference', () => {
    expect(metricDelta(4, 4, 'higher')).toEqual({
      baseline: 4,
      current: 4,
      absoluteChange: 0,
      relativeChange: 0,
      direction: 'same',
    })
  })

  it('reads direction from the metric, not from the sign', () => {
    expect(metricDelta(2, 3, 'higher').direction).toBe('better')
    expect(metricDelta(2, 3, 'lower').direction).toBe('worse')
    expect(metricDelta(3, 2, 'higher').direction).toBe('worse')
    expect(metricDelta(3, 2, 'lower').direction).toBe('better')
  })

  it('computes a relative change against the baseline', () => {
    const delta = metricDelta(200, 250, 'lower')
    expect(delta.absoluteChange).toBe(50)
    expect(delta.relativeChange).toBeCloseTo(0.25, 10)
  })

  it('reports an undefined ratio as null rather than Infinity', () => {
    const delta = metricDelta(0, 5, 'lower')
    expect(delta.relativeChange).toBeNull()
    expect(delta.absoluteChange).toBe(5)
    expect(delta.direction).toBe('worse')
  })

  it('handles an infinite safety factor on either side', () => {
    const gained = metricDelta(3, Number.POSITIVE_INFINITY, 'higher')
    expect(gained.direction).toBe('better')
    expect(gained.absoluteChange).toBeNull()
    expect(gained.relativeChange).toBeNull()

    const lost = metricDelta(Number.POSITIVE_INFINITY, 3, 'higher')
    expect(lost.direction).toBe('worse')

    const both = metricDelta(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 'higher')
    expect(both.direction).toBe('same')
    expect(both.absoluteChange).toBeNull()
  })

  it('says unknown rather than guessing when a value is NaN', () => {
    expect(metricDelta(Number.NaN, 3, 'higher').direction).toBe('unknown')
    expect(metricDelta(3, Number.NaN, 'higher').direction).toBe('unknown')
  })
})

describe('compareDesigns', () => {
  it('is all-same when a design is compared with itself', () => {
    const only = snapshot(structure())
    const comparison = compareDesigns(only, only)
    for (const key of [
      'safetyFactor', 'driftRatio', 'carbonKg', 'costUsd',
      'carbonIntensity_kgCO2e_m2', 'costIntensity_usd_m2',
    ] as const) {
      expect(comparison[key].direction).toBe('same')
    }
    expect(comparison.baselineGoverningFailureMode)
      .toBe(comparison.currentGoverningFailureMode)
  })

  it('shows the tradeoff: a stiffer, heavier material buys safety with carbon', () => {
    const timber = snapshot(structure())
    const concrete = snapshot(
      structure({
        storeys: structure().storeys.map((storey) => ({
          ...storey,
          materialId: 'reinforced-concrete',
        })),
      }),
    )
    const comparison = compareDesigns(timber, concrete)

    expect(comparison.carbonKg.direction).toBe('worse')
    expect(comparison.driftRatio.direction).toBe('better')
    // The point of the panel: the two move in opposite directions at once.
    expect(comparison.carbonKg.direction).not.toBe(comparison.driftRatio.direction)
  })

  it('separates a total from an intensity when the building grows', () => {
    const short = snapshot(structure({}, 4))
    const tall = snapshot(structure({}, 12))
    const comparison = compareDesigns(short, tall)

    // Three times the floors is unambiguously more carbon in total...
    expect(comparison.carbonKg.direction).toBe('worse')
    expect(comparison.carbonKg.relativeChange).toBeGreaterThan(1)
    // ...while per square metre the storeys are identical, so intensity is not
    // where the change shows up. Totals alone would call the taller design
    // three times worse and teach the wrong lesson.
    expect(comparison.carbonIntensity_kgCO2e_m2.relativeChange).toBeCloseTo(0, 10)
  })

  it('survives a zero-gust baseline, where drift is 0 and safety is infinite', () => {
    const calm = snapshot(structure(), { ...HAZARD, gustSpeed_kmh: 0 })
    const gale = snapshot(structure())
    const comparison = compareDesigns(calm, gale)

    expect(comparison.driftRatio.baseline).toBe(0)
    expect(comparison.driftRatio.relativeChange).toBeNull()
    expect(comparison.driftRatio.direction).toBe('worse')
    expect(comparison.safetyFactor.direction).toBe('worse')
    // Carbon does not depend on the wind, so it must be untouched.
    expect(comparison.carbonKg.direction).toBe('same')
  })

  it('reports a change of governing failure mode', () => {
    const calm = snapshot(structure(), { ...HAZARD, gustSpeed_kmh: 0 })
    const storm = snapshot(structure(), { ...HAZARD, gustSpeed_kmh: 300 })
    const comparison = compareDesigns(calm, storm)
    expect(comparison.baselineGoverningFailureMode).toBe('none')
    expect(comparison.currentGoverningFailureMode).not.toBe('none')
  })
})
