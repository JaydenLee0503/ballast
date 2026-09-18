/**
 * Reading a provider response that is not shaped the way the contract says.
 *
 * The fixture in `provider.fixture.json` is not invented: it is a body
 * Featherless actually returned, captured off the wire. HTTP 200, and *two*
 * concatenated JSON objects — a stub `chat.completion` reporting zero tokens,
 * then `{"error":{"message":"No successful response received from completion
 * service","type":"server_error","code":"no_response"}}`.
 *
 * `JSON.parse` on that throws "Unexpected non-whitespace character after JSON
 * at position 1691", which is what a student saw instead of an explanation.
 * These tests hold the two things that matter: the body is read at all, and the
 * sentence the provider wrote is the sentence that comes out.
 */

import { describe, expect, it } from 'vitest'
import { splitJsonValues } from './aiProvider.ts'
import fixture from './provider.fixture.json' with { type: 'json' }

const TWO_OBJECT_BODY: string = fixture.twoObjectBody

describe('the body that broke it', () => {
  it('is genuinely two JSON values, not one', () => {
    expect(() => JSON.parse(TWO_OBJECT_BODY)).toThrow()
    expect(splitJsonValues(TWO_OBJECT_BODY)).toHaveLength(2)
  })

  it('carries the real reason in its second value', () => {
    const [, second] = splitJsonValues(TWO_OBJECT_BODY) as [unknown, { error: { message: string } }]
    expect(second.error.message).toMatch(/No successful response received/)
  })

  it('reports a completion that spent no tokens, which is the tell', () => {
    const [first] = splitJsonValues(TWO_OBJECT_BODY) as [{ usage: { total_tokens: number } }]
    expect(first.usage.total_tokens).toBe(0)
  })
})

describe('splitting values', () => {
  it('handles the ordinary single-object case', () => {
    expect(splitJsonValues('{"a":1}')).toEqual([{ a: 1 }])
  })

  it('is not fooled by braces inside strings', () => {
    // The whole point: a completion's `content` is a JSON string full of
    // braces, and counting them naively splits in the middle of the reply.
    const body = '{"content":"{\\"verdict\\":\\"ok\\"}"}{"error":{"message":"x"}}'
    const values = splitJsonValues(body)
    expect(values).toHaveLength(2)
    expect((values[0] as { content: string }).content).toBe('{"verdict":"ok"}')
  })

  it('is not fooled by an escaped quote before a brace', () => {
    expect(splitJsonValues('{"a":"\\\\"}{"b":2}')).toHaveLength(2)
  })

  it('skips a trailing fragment rather than losing the good value', () => {
    expect(splitJsonValues('{"a":1}{"b":')).toEqual([{ a: 1 }])
  })

  it('returns nothing for a body with no JSON in it', () => {
    expect(splitJsonValues('upstream connect error')).toEqual([])
  })

  it('handles a top-level array', () => {
    expect(splitJsonValues('[1,2]')).toEqual([[1, 2]])
  })
})
