/**
 * The context is the only thing the model sees, so what it contains -- and
 * what it does not -- is a correctness question, not a formatting one.
 */

import { describe, expect, it } from 'vitest'
import { analyze, MATERIAL_LIBRARY, TARGET_SAFETY_FACTOR } from '@/engine'
import { buildCritiqueContext } from './context.ts'
import { collectByBucket } from './guard.ts'
import { DEMO_HAZARD, DEMO_STRUCTURE, demoContext } from './fixtures.test-support.ts'

const context = demoContext()

describe('what the model is given', () => {
  it('reports the hazard it was analysed under', () => {
    expect(context.hazard.gustSpeed_kmh).toBe(DEMO_HAZARD.gustSpeed_kmh)
    expect(context.hazard.exposureCategory).toBe(DEMO_STRUCTURE.exposureCategory)
    expect(context.hazard.exposureDescription).not.toBe('')
  })

  it('labels storeys from 1 at the ground, matching the table the student sees', () => {
    expect(context.storeys.map((storey) => storey.label)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('names the material of each storey rather than its id', () => {
    for (const storey of context.storeys) {
      expect(storey.materialName).not.toBe('unknown')
      expect(storey.materialName).not.toBe('cross-laminated-timber')
    }
  })

  it('includes the whole material library, so suggestions stay buildable', () => {
    expect(context.materials).toHaveLength(MATERIAL_LIBRARY.size)
  })

  it('carries the limits, so the model can say what a figure is measured against', () => {
    expect(context.limits.targetSafetyFactor).toBe(TARGET_SAFETY_FACTOR)
    expect(context.limits.driftLimitDenominator).toBe(500)
  })

  it('passes engine warnings through unaltered', () => {
    const result = analyze(DEMO_STRUCTURE, DEMO_HAZARD, MATERIAL_LIBRARY)
    expect(context.warnings).toEqual(result.warnings)
  })
})

describe('rounding', () => {
  it('rounds every figure to the precision the UI shows', () => {
    // The guard compares the model's prose against exactly these values, so
    // rounding once here is what makes traceability decidable.
    expect(context.score.safetyFactor).toBe(
      Math.round(context.score.safetyFactor * 100) / 100,
    )
    expect(Number.isInteger(context.stability.overturningMoment_kNm)).toBe(true)
    expect(Number.isInteger(context.score.carbon_kgCO2e)).toBe(true)
  })

  it('quotes drift as an integer denominator rather than a long decimal', () => {
    for (const storey of context.storeys) {
      expect(Number.isInteger(storey.driftDenominator)).toBe(true)
    }
    expect(Number.isInteger(context.score.worstDriftDenominator)).toBe(true)
  })

  it('derives intensities from the engine floor area, not from a UI guess', () => {
    expect(context.score.carbonIntensity_kgCO2e_m2).toBeCloseTo(
      context.score.carbon_kgCO2e / context.building.floorArea_m2,
      0,
    )
  })

  it('reports slenderness against the narrow plan dimension', () => {
    // 21 m tall over a 12 m narrow side.
    expect(context.building.slendernessRatio).toBeCloseTo(21 / 12, 2)
  })
})

describe('degenerate inputs', () => {
  it('represents a still-air safety factor as Infinity rather than NaN', () => {
    const calm = { ...DEMO_HAZARD, gustSpeed_kmh: 0 }
    const result = analyze(DEMO_STRUCTURE, calm, MATERIAL_LIBRARY)
    const built = buildCritiqueContext(result, DEMO_STRUCTURE, calm, MATERIAL_LIBRARY)
    expect(Number.isNaN(built.score.safetyFactor)).toBe(false)
    expect(built.score.worstDriftDenominator).toBe(Infinity)
  })

  it('keeps every finite figure out of the count bucket by naming its unit', () => {
    // The guard can only check a figure whose dimension it can work out, and
    // it works dimensions out from field names. A field that lands in `count`
    // is one the guard will never be able to verify a quotation of.
    const buckets = collectByBucket(context)
    const uncheckable = buckets.get('count') ?? []
    // storeyCount, the storey labels and directionDeg are the only ones that
    // legitimately have no dimension.
    expect(uncheckable.length).toBe(1 + context.storeys.length + 1)
  })
})
