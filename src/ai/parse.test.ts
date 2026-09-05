/**
 * The parser exists because a 70B-class open-weight model asked for "JSON and
 * nothing else" complies most of the time. These cases are the rest of the
 * time.
 */

import { describe, expect, it } from 'vitest'
import { extractJsonObject, parseCritique } from './parse.ts'

const WELL_FORMED = JSON.stringify({
  verdict: 'It stands, comfortably.',
  explanation: 'The base is wide relative to the height.',
  suggestions: [
    { change: 'Switch to CLT', rationale: 'Lower carbon', tradeoff: 'Less stiff' },
  ],
})

describe('extractJsonObject', () => {
  it('finds an object wrapped in prose and a code fence', () => {
    const text = 'Sure! Here you go:\n```json\n{"a":1}\n```\nHope that helps.'
    expect(extractJsonObject(text)).toBe('{"a":1}')
  })

  it('does not stop at a brace inside a string', () => {
    const text = '{"note":"use a } brace","ok":true}'
    expect(extractJsonObject(text)).toBe(text)
  })

  it('handles an escaped quote before a brace', () => {
    const text = '{"note":"a \\" then }","ok":true}'
    expect(extractJsonObject(text)).toBe(text)
  })

  it('returns null when the object never closes', () => {
    expect(extractJsonObject('{"verdict":"truncated mid')).toBeNull()
  })

  it('returns null when there is no object at all', () => {
    expect(extractJsonObject('I cannot help with that.')).toBeNull()
  })
})

describe('parseCritique', () => {
  it('reads a well-formed reply', () => {
    const { critique, parsedAsJson } = parseCritique(WELL_FORMED)
    expect(parsedAsJson).toBe(true)
    expect(critique.verdict).toBe('It stands, comfortably.')
    expect(critique.suggestions).toHaveLength(1)
  })

  it('reads it through a preamble and a code fence', () => {
    const { critique, parsedAsJson } = parseCritique(
      `Here is my critique:\n\`\`\`json\n${WELL_FORMED}\n\`\`\``,
    )
    expect(parsedAsJson).toBe(true)
    expect(critique.verdict).toBe('It stands, comfortably.')
  })

  it('falls back to prose rather than erroring on malformed JSON', () => {
    const { critique, parsedAsJson } = parseCritique('{"verdict": unquoted}')
    expect(parsedAsJson).toBe(false)
    expect(critique.explanation).toContain('unquoted')
    expect(critique.suggestions).toEqual([])
  })

  it('falls back to prose when the model just writes an answer', () => {
    const { critique, parsedAsJson } = parseCritique('The building is too slender.')
    expect(parsedAsJson).toBe(false)
    expect(critique.explanation).toBe('The building is too slender.')
  })

  it('treats a structurally valid but empty object as prose', () => {
    // Rendering blank headings is worse than showing what the model said.
    const { parsedAsJson } = parseCritique('{"verdict":"","explanation":""}')
    expect(parsedAsJson).toBe(false)
  })

  it('drops suggestions with no actionable change', () => {
    const raw = JSON.stringify({
      verdict: 'Fine.',
      explanation: 'Fine.',
      suggestions: [
        { rationale: 'orphaned', tradeoff: 'none' },
        { change: 'Widen the base', rationale: '', tradeoff: '' },
      ],
    })
    const { critique } = parseCritique(raw)
    expect(critique.suggestions).toHaveLength(1)
    expect(critique.suggestions[0]!.change).toBe('Widen the base')
  })

  it('survives suggestions arriving as something other than an array', () => {
    const raw = '{"verdict":"Fine.","explanation":"Fine.","suggestions":"none"}'
    const { critique, parsedAsJson } = parseCritique(raw)
    expect(parsedAsJson).toBe(true)
    expect(critique.suggestions).toEqual([])
  })
})
