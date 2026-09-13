/**
 * Crack layout. The property that matters is determinism: the same storey
 * cracks in the same places every run, on every machine. A student who runs the
 * same storm twice and gets a differently broken building learns that the
 * picture is decorative.
 */

import { describe, expect, it } from 'vitest'
import { crackPolylines, CRACK_COUNT } from './cracks.ts'

describe('crack polylines', () => {
  it('gives the same answer for the same seed, every time', () => {
    expect(crackPolylines(3, 5)).toEqual(crackPolylines(3, 5))
  })

  it('gives different storeys different cracks', () => {
    expect(crackPolylines(1, 5)).not.toEqual(crackPolylines(2, 5))
  })

  it('draws nothing when asked for nothing', () => {
    expect(crackPolylines(1, 0)).toEqual([])
  })

  it('stays inside the wall it is drawn on', () => {
    for (const crack of crackPolylines(7, 9)) {
      for (const point of crack) {
        expect(point.u).toBeGreaterThanOrEqual(0)
        expect(point.u).toBeLessThan(1)
        expect(point.v).toBeGreaterThanOrEqual(0)
        expect(point.v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('climbs, because a storey is worked hardest at its base', () => {
    for (const crack of crackPolylines(11, 8)) {
      const first = crack[0]
      const last = crack[crack.length - 1]
      expect(last!.v).toBeGreaterThan(first!.v)
    }
  })

  it('is a line, not a point', () => {
    for (const crack of crackPolylines(5, 6)) {
      expect(crack.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('draws more of them the worse the damage gets', () => {
    expect(CRACK_COUNT['intact']).toBe(0)
    expect(CRACK_COUNT['severe']!).toBeGreaterThan(CRACK_COUNT['cracked']!)
  })
})
