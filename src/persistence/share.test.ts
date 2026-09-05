import { describe, expect, it } from 'vitest'
import { MATERIAL_LIBRARY, type Structure } from '@/engine'
import { STOREY_COUNT_LIMITS } from '@/lib/limits.ts'
import { DEFAULT_HAZARD, DEFAULT_STRUCTURE } from '@/store/design.ts'
import { createSavedDesign, DesignParseError } from './schema.ts'
import {
  decodeDesign,
  encodeDesign,
  MAX_TOKEN_LENGTH,
  readShareToken,
  shareUrl,
} from './share.ts'

const SAVED_AT = new Date('2026-03-01T12:00:00.000Z')
const PAGE = 'https://resilience.example/studio?tab=design'

function design(name = 'Baseline CLT', structure: Structure = DEFAULT_STRUCTURE) {
  return createSavedDesign(name, structure, DEFAULT_HAZARD, SAVED_AT)
}

describe('round trip', () => {
  it('returns an equal design', () => {
    const original = design()
    expect(decodeDesign(encodeDesign(original), MATERIAL_LIBRARY)).toEqual(original)
  })

  it('survives a name outside ASCII', () => {
    const original = design('타워 · Tour · 塔 🌪')
    expect(decodeDesign(encodeDesign(original), MATERIAL_LIBRARY).name).toBe(original.name)
  })

  it('produces a token that is URL-safe as-is', () => {
    expect(encodeDesign(design())).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('token length', () => {
  it('stays well inside the limit for the largest design the app allows', () => {
    const storey = DEFAULT_STRUCTURE.storeys[0]
    if (storey === undefined) throw new Error('default structure has no storeys')
    const maxStructure: Structure = {
      ...DEFAULT_STRUCTURE,
      storeys: Array.from({ length: STOREY_COUNT_LIMITS.max }, () => ({ ...storey })),
    }
    const length = encodeDesign(design('x'.repeat(80), maxStructure)).length
    // Measured at 4060 when this was written; pinned with headroom so a
    // schema change that inflates the payload shows up here first.
    expect(length).toBeLessThan(MAX_TOKEN_LENGTH)
    expect(length).toBeLessThan(4500)
  })

  it('refuses an oversized token without trying to decode it', () => {
    expect(() => decodeDesign('A'.repeat(MAX_TOKEN_LENGTH + 1), MATERIAL_LIBRARY))
      .toThrow(/over the \d+ limit/)
  })
})

describe('damaged links', () => {
  it.each([
    ['truncated', (t: string) => t.slice(0, Math.floor(t.length / 2))],
    ['non-base64 characters', () => '!!!not base64!!!'],
    ['valid base64 that is not JSON', () => 'aGVsbG8gd29ybGQ'],
    ['empty', () => ''],
  ])('reports %s as a parse error rather than crashing', (_label, damage) => {
    const token = damage(encodeDesign(design()))
    expect(() => decodeDesign(token, MATERIAL_LIBRARY)).toThrow(DesignParseError)
  })

  it('applies the same validation as a stored design', () => {
    // Hand-built token carrying a material the library does not have.
    const payload = JSON.stringify({
      ...design(),
      structure: {
        ...DEFAULT_STRUCTURE,
        storeys: [{ ...DEFAULT_STRUCTURE.storeys[0], materialId: 'unobtainium' }],
      },
    })
    const token = btoa(String.fromCharCode(...new TextEncoder().encode(payload)))
      .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
    expect(() => decodeDesign(token, MATERIAL_LIBRARY)).toThrow(/unobtainium/)
  })
})

describe('urls', () => {
  it('keeps the origin and path, and puts the token in the fragment', () => {
    const url = new URL(shareUrl(design(), PAGE))
    expect(url.origin).toBe('https://resilience.example')
    expect(url.pathname).toBe('/studio')
    expect(url.search).toBe('?tab=design')
    expect(url.hash.startsWith('#design=')).toBe(true)
  })

  it('round-trips through readShareToken', () => {
    const original = design()
    const token = readShareToken(shareUrl(original, PAGE))
    expect(token).not.toBeNull()
    expect(decodeDesign(token as string, MATERIAL_LIBRARY)).toEqual(original)
  })

  it.each([
    ['no fragment', PAGE],
    ['an unrelated fragment', `${PAGE}#section=intro`],
    ['an empty token', `${PAGE}#design=`],
    ['not a url at all', 'nonsense'],
  ])('returns null for %s', (_label, url) => {
    expect(readShareToken(url)).toBeNull()
  })
})
