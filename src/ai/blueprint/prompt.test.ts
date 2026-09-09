/**
 * The prompt's hard rules are behaviour, so softening one should fail the suite
 * rather than quietly change what the model is allowed to do. Same framing as
 * `ai/prompt.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import { MATERIAL_LIBRARY } from '@/engine'
import { buildBlueprintCatalogue } from './catalogue.ts'
import { BLUEPRINT_SYSTEM_PROMPT, buildBlueprintMessages, renderCatalogue } from './prompt.ts'
import { BLUEPRINT_CAVEATS } from './types.ts'

describe('the blueprint system prompt', () => {
  it('forbids stating or predicting a result', () => {
    expect(BLUEPRINT_SYSTEM_PROMPT).toMatch(/Never state or predict a result/i)
    expect(BLUEPRINT_SYSTEM_PROMPT).toMatch(/safety factor/i)
  })

  it('requires ids to come verbatim from the catalogue', () => {
    expect(BLUEPRINT_SYSTEM_PROMPT).toMatch(/verbatim in the CATALOGUE/)
    expect(BLUEPRINT_SYSTEM_PROMPT).toMatch(/never invent one/i)
  })

  it('requires the caveats rather than leaving honesty optional', () => {
    expect(BLUEPRINT_SYSTEM_PROMPT).toMatch(/list every matching caveat id/i)
    expect(BLUEPRINT_SYSTEM_PROMPT).toMatch(/the app prints the caveat text itself/i)
  })

  it('offers sections for a building with differently sized parts', () => {
    expect(BLUEPRINT_SYSTEM_PROMPT).toMatch(/say so with "sections", listed from the ground up/)
    // And still says what happens without them, so a plain block stays plain.
    expect(BLUEPRINT_SYSTEM_PROMPT).toMatch(/identical apart from the taper/)
  })

  it('says every storey sits fully on the one below', () => {
    expect(BLUEPRINT_SYSTEM_PROMPT).toMatch(/sits fully on the one below/)
  })
})

describe('renderCatalogue', () => {
  const catalogue = buildBlueprintCatalogue()

  it('lists every material in the library by id', () => {
    const text = renderCatalogue(catalogue)
    for (const id of MATERIAL_LIBRARY.keys()) expect(text).toContain(id)
  })

  it('lists every caveat id with its sentence', () => {
    const text = renderCatalogue(catalogue)
    for (const caveat of BLUEPRINT_CAVEATS) {
      expect(text).toContain(caveat.id)
      expect(text).toContain(caveat.description)
    }
  })

  it('offers the footprints, described by what they do', () => {
    const text = renderCatalogue(catalogue)
    expect(text).toContain('PLAN SHAPES')
    expect(text).toContain('ellipse')
    expect(text).toMatch(/Sheds wind rather than catching it/)
  })

  it('states the editing ranges, so a proposal lands inside the controls', () => {
    const text = renderCatalogue(catalogue)
    expect(text).toMatch(/storeyCount: 1 to 24/)
    expect(text).toMatch(/widthX_m and widthY_m: 4 to 60/)
  })

  it('tells the model which systems each material can form', () => {
    // Rammed earth cannot be a moment frame, and the model should not have to
    // discover that from a warning after the fact.
    const earth = catalogue.materials.find((entry) => entry.id === 'rammed-earth')
    expect(earth?.buildableSystems).not.toContain('moment-frame')
  })
})

describe('buildBlueprintMessages', () => {
  it('carries the request and nothing but the catalogue besides', () => {
    const messages = buildBlueprintMessages('an arena', buildBlueprintCatalogue())
    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe('system')
    expect(messages[1]?.content).toContain('an arena')
    expect(messages[1]?.content).toContain('CATALOGUE')
  })

  it('trims the description, so a stray newline is not part of the request', () => {
    const messages = buildBlueprintMessages('  a school \n', buildBlueprintCatalogue())
    expect(messages[1]?.content).toContain('THE STUDENT ASKED FOR\n\na school\n')
  })
})
