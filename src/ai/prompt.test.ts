/**
 * The prompt is where the one rule is stated to the model. If an edit ever
 * softens it, these tests fail rather than the app quietly starting to
 * publish invented numbers.
 */

import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT, buildMessages, renderFacts } from './prompt.ts'
import { demoContext } from './fixtures.test-support.ts'

const context = demoContext()

describe('system prompt', () => {
  it('forbids producing numbers', () => {
    expect(SYSTEM_PROMPT).toMatch(/never compute, estimate, derive or invent a number/i)
  })

  it('forbids predicting the result of a change', () => {
    expect(SYSTEM_PROMPT).toMatch(/never say by how much/i)
  })

  it('confines recommendations to the supplied library', () => {
    expect(SYSTEM_PROMPT).toMatch(/only recommend materials and lateral systems listed/i)
  })

  it('asks for a tradeoff on every suggestion', () => {
    expect(SYSTEM_PROMPT).toMatch(/tradeoff/i)
  })
})

describe('renderFacts', () => {
  const facts = renderFacts(context)

  it('carries every scorecard figure the model might want to quote', () => {
    expect(facts).toContain(context.score.governingFailureMode)
    expect(facts).toContain(context.stability.baseShear_kN.toFixed(1))
    expect(facts).toContain(context.score.safetyFactor.toFixed(2))
    expect(facts).toContain(`h/${context.score.worstDriftDenominator}`)
    expect(facts).toContain(context.score.carbon_kgCO2e.toFixed(0))
    expect(facts).toContain(context.score.cost_usd.toFixed(0))
  })

  it('lists one line per storey, numbered from the ground up', () => {
    for (const storey of context.storeys) {
      expect(facts).toContain(`Storey ${storey.label}: ${storey.materialName}`)
    }
  })

  it('lists the material library, so suggestions cannot invent a material', () => {
    for (const material of context.materials) {
      expect(facts).toContain(material.name)
    }
    expect(facts).toMatch(/the only ones you may recommend/i)
  })

  it('passes the engine warnings through instead of hiding them', () => {
    for (const warning of context.warnings) expect(facts).toContain(warning)
  })

  it('never renders a raw Infinity or NaN', () => {
    // Still air gives an infinite safety factor. "Infinity kN" in a prompt is
    // an invitation for the model to repeat it as if it meant something.
    const calm = renderFacts({
      ...context,
      score: { ...context.score, safetyFactor: Infinity, worstDriftDenominator: Infinity },
    })
    expect(calm).not.toContain('Infinity')
    expect(calm).not.toContain('NaN')
  })
})

describe('buildMessages', () => {
  it('puts the rules in the system turn and the facts in the user turn', () => {
    const messages = buildMessages(context)
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('system')
    expect(messages[1]!.role).toBe('user')
    expect(messages[1]!.content).toContain('BUILDING')
  })

  it('is deterministic for a given context', () => {
    expect(buildMessages(context)).toEqual(buildMessages(context))
  })
})
