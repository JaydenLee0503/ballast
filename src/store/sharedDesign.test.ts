/**
 * The `Navigation` injection is what makes this testable at all — the same
 * seam lets a test assert the thing that is easy to get wrong, that the
 * fragment is cleared on the failure path too.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createSavedDesign, shareUrl } from '@/persistence'
import { DEFAULT_HAZARD, DEFAULT_STRUCTURE, useDesignStore } from './design.ts'
import { consumeSharedDesign, sharedDesignOutcome, type Navigation } from './sharedDesign.ts'

const PAGE = 'https://resilience.example/studio?tab=design'

function fakeNavigation(href: string) {
  const calls: string[] = []
  const navigation: Navigation = { href, replace: (url) => calls.push(url) }
  return { navigation, calls }
}

/** A design that is clearly not the default, so a load is unmistakable. */
function sharedDesign() {
  const storey = DEFAULT_STRUCTURE.storeys[0]
  if (storey === undefined) throw new Error('default structure has no storeys')
  return createSavedDesign(
    'Braced steel tower',
    {
      ...DEFAULT_STRUCTURE,
      storeys: Array.from({ length: 9 }, () => ({
        ...storey,
        materialId: 'structural-steel',
        lateralSystem: 'braced-frame' as const,
      })),
    },
    { ...DEFAULT_HAZARD, gustSpeed_kmh: 210 },
    new Date('2026-03-01T12:00:00.000Z'),
  )
}

beforeEach(() => {
  useDesignStore.getState().reset()
})

describe('no link', () => {
  it('leaves the design and the address bar alone', () => {
    const { navigation, calls } = fakeNavigation(PAGE)
    expect(consumeSharedDesign(navigation)).toEqual({ loadedName: null, error: null })
    expect(calls).toEqual([])
    expect(useDesignStore.getState().structure).toBe(DEFAULT_STRUCTURE)
  })
})

describe('a good link', () => {
  it('replaces the design in the store', () => {
    const design = sharedDesign()
    const { navigation } = fakeNavigation(shareUrl(design, PAGE))

    expect(consumeSharedDesign(navigation).loadedName).toBe('Braced steel tower')

    const state = useDesignStore.getState()
    expect(state.structure.storeys).toHaveLength(9)
    expect(state.structure.storeys[0]?.materialId).toBe('structural-steel')
    expect(state.hazard.gustSpeed_kmh).toBe(210)
  })

  it('clears the fragment but keeps the path and query', () => {
    const { navigation, calls } = fakeNavigation(shareUrl(sharedDesign(), PAGE))
    consumeSharedDesign(navigation)
    expect(calls).toEqual(['https://resilience.example/studio?tab=design'])
  })

  it('drops a stale storey selection, which would point into the old design', () => {
    useDesignStore.getState().selectStorey(4)
    const { navigation } = fakeNavigation(shareUrl(sharedDesign(), PAGE))
    consumeSharedDesign(navigation)
    expect(useDesignStore.getState().selectedStoreyIndex).toBeNull()
  })
})

describe('a damaged link', () => {
  it('reports the reason and leaves the design untouched', () => {
    const { navigation } = fakeNavigation(`${PAGE}#design=not-a-real-token`)
    const result = consumeSharedDesign(navigation)
    expect(result.loadedName).toBeNull()
    expect(result.error).toMatch(/damaged|incomplete|JSON/i)
    expect(useDesignStore.getState().structure).toBe(DEFAULT_STRUCTURE)
  })

  it('still clears the fragment, so a refresh does not repeat the failure', () => {
    const { navigation, calls } = fakeNavigation(`${PAGE}#design=not-a-real-token`)
    consumeSharedDesign(navigation)
    expect(calls).toEqual(['https://resilience.example/studio?tab=design'])
  })
})

describe('sharedDesignOutcome', () => {
  it('reports what the last consume found', () => {
    consumeSharedDesign(fakeNavigation(shareUrl(sharedDesign(), PAGE)).navigation)
    expect(sharedDesignOutcome().loadedName).toBe('Braced steel tower')

    consumeSharedDesign(fakeNavigation(PAGE).navigation)
    expect(sharedDesignOutcome()).toEqual({ loadedName: null, error: null })
  })
})
