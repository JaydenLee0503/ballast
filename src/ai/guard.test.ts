/**
 * The guard is the automated form of the project's one rule, so these tests
 * are written from the attacker's side: what could a model say that is wrong
 * and still slip through?
 */

import { describe, expect, it } from 'vitest'
import { bucketForKey, collectByBucket, findUntraceableFigures } from './guard.ts'
import { demoContext, says } from './fixtures.test-support.ts'

const context = demoContext()
const flags = (text: string) => findUntraceableFigures(says(text), context)

/**
 * A drift denominator no storey reports. Derived rather than hard-coded: the
 * demo structure's storeys sit at h/769 through h/4015, so a literal like
 * h/900 lands within the 0.5% tolerance of a real one and the test would be
 * asserting the opposite of what it reads as.
 */
function unusedDenominator(): number {
  const used = [
    context.limits.driftLimitDenominator,
    context.score.worstDriftDenominator,
    ...context.storeys.map((storey) => storey.driftDenominator),
  ]
  return Math.max(...used) * 3 + 7
}

describe('unit derivation from field names', () => {
  it('prefers the longest matching suffix', () => {
    expect(bucketForKey('embodiedCarbon_kgCO2e_m3')).toBe('carbonDensity')
    expect(bucketForKey('carbonIntensity_kgCO2e_m2')).toBe('carbonIntensity')
    expect(bucketForKey('carbon_kgCO2e')).toBe('mass')
    expect(bucketForKey('cost_usd_m3')).toBe('moneyDensity')
    expect(bucketForKey('costIntensity_usd_m2')).toBe('moneyIntensity')
    expect(bucketForKey('cost_usd')).toBe('money')
    expect(bucketForKey('overturningMoment_kNm')).toBe('moment')
    expect(bucketForKey('baseShear_kN')).toBe('force')
    expect(bucketForKey('density_kg_m3')).toBe('density')
  })

  it('files dimensionless quantities apart from counts', () => {
    expect(bucketForKey('factorOfSafetyOverturning')).toBe('factor')
    expect(bucketForKey('driftUtilization')).toBe('ratio')
    expect(bucketForKey('worstDriftDenominator')).toBe('denominator')
    // Nothing may be justified by a storey count or a bearing.
    expect(bucketForKey('storeyCount')).toBe('count')
    expect(bucketForKey('directionDeg')).toBe('count')
  })

  it('collects context numbers under the dimension their name declares', () => {
    const buckets = collectByBucket(context)
    expect(buckets.get('force')).toContain(context.stability.baseShear_kN)
    expect(buckets.get('density')).toContain(context.materials[0]!.density_kg_m3)
  })
})

describe('figures the engine actually produced', () => {
  it('accepts a quantity quoted exactly', () => {
    expect(flags(`The base shear is ${context.stability.baseShear_kN} kN.`)).toEqual([])
  })

  it('accepts correct rounding to fewer decimals', () => {
    const exact = context.stability.factorOfSafetyOverturning
    expect(flags(`The factor of safety is ${exact.toFixed(1)}.`)).toEqual([])
  })

  it('accepts carbon rescaled into tonnes', () => {
    const tonnes = (context.score.carbon_kgCO2e / 1000).toFixed(1)
    expect(flags(`That is ${tonnes} t of embodied carbon.`)).toEqual([])
  })

  it('accepts cost rescaled into thousands', () => {
    const thousands = Math.round(context.score.cost_usd / 1000)
    expect(flags(`The frame costs about $${thousands}k.`)).toEqual([])
  })

  it('accepts a utilisation quoted as a percentage', () => {
    const storey = context.storeys[0]!
    const percent = (storey.utilization * 100).toFixed(0)
    expect(flags(`Storey 1 is at ${percent}% of its limit.`)).toEqual([])
  })

  it('accepts a drift ratio written in h/N form', () => {
    expect(flags(`Drift reaches h/${context.score.worstDriftDenominator}.`)).toEqual([])
  })
})

describe('figures the model made up', () => {
  it('flags an invented force', () => {
    const invented = context.stability.baseShear_kN + 500
    const found = flags(`The base shear is ${invented} kN.`)
    expect(found).toHaveLength(1)
    expect(found[0]!.unit).toBe('kN')
  })

  it('flags an invented safety factor', () => {
    const found = flags('This gives a safety factor of 9.87.')
    expect(found).toHaveLength(1)
    expect(found[0]!.value).toBeCloseTo(9.87, 10)
  })

  it('flags a drift ratio the engine never reported', () => {
    const found = flags('The top storey drifts h/17.')
    expect(found).toHaveLength(1)
    expect(found[0]!.unit).toBe('drift denominator')
  })

  it('flags a predicted result, which is the failure mode that matters most', () => {
    // Rule 4 of the system prompt: never say by how much a change would help.
    const found = flags('Widening the base would lift the safety factor to 2.40.')
    expect(found).toHaveLength(1)
  })

  it('will not let a number of one dimension excuse a figure of another', () => {
    // Reinforced concrete's density is in the context as 2280 kg/m3. Quoted
    // as a force it is an invention, and pooling all numbers into one set
    // would have let it through.
    const density = context.materials.find((m) => m.structuralClass === 'concrete')
    expect(density).toBeDefined()
    const found = flags(`The base shear is ${density!.density_kg_m3} kN.`)
    expect(found).toHaveLength(1)
    expect(found[0]!.unit).toBe('kN')
  })

  it('reports a repeated invention once', () => {
    const found = flags('It is 4321 kN. I say again, 4321 kN.')
    expect(found).toHaveLength(1)
  })
})

describe('prose that is not a claim about the physics', () => {
  it('ignores bare integers', () => {
    expect(flags('Storey 4 is the worst, and two of the three dials are red.')).toEqual([])
  })

  it('ignores ordinals and list positions', () => {
    expect(flags('The first suggestion matters more than the second.')).toEqual([])
  })

  it('scans suggestions as well as the explanation', () => {
    const found = findUntraceableFigures(
      {
        verdict: '',
        explanation: '',
        suggestions: [
          {
            change: 'Add bracing',
            rationale: `Cuts drift to h/${unusedDenominator()}.`,
            tradeoff: 'More steel.',
          },
        ],
      },
      context,
    )
    expect(found).toHaveLength(1)
  })
})
