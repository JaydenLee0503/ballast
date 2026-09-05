/**
 * The baseline is the part of the store with behaviour rather than assignment,
 * so it is the part worth pinning: it follows a design that gets opened, it
 * survives edits, and it goes back to the start when the studio does.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createSavedDesign } from '@/persistence'
import {
  DEFAULT_HAZARD,
  DEFAULT_STRUCTURE,
  STARTING_BASELINE,
  useDesignStore,
} from './design.ts'

beforeEach(() => {
  useDesignStore.getState().reset()
})

describe('baseline', () => {
  it('starts as the design the studio opens with', () => {
    expect(useDesignStore.getState().baseline).toBe(STARTING_BASELINE)
  })

  it('does not move when the design is edited', () => {
    const before = useDesignStore.getState().baseline
    useDesignStore.getState().setGustSpeed(240)
    useDesignStore.getState().addStorey()
    useDesignStore.getState().setAllMaterial('reinforced-concrete')
    const after = useDesignStore.getState()
    expect(after.baseline).toBe(before)
    // The whole point: the current design has moved away from it.
    expect(after.structure).not.toBe(after.baseline.structure)
  })

  it('pins the design on screen, edits included', () => {
    useDesignStore.getState().setGustSpeed(240)
    useDesignStore.getState().pinBaseline()

    const state = useDesignStore.getState()
    expect(state.baseline.structure).toBe(state.structure)
    expect(state.baseline.hazard).toBe(state.hazard)
    expect(state.baseline.hazard.gustSpeed_kmh).toBe(240)
    expect(state.baseline.label).toBe('Pinned design')
  })

  it('follows a design that is opened, under its own name', () => {
    const design = createSavedDesign(
      'Coastal block',
      DEFAULT_STRUCTURE,
      { ...DEFAULT_HAZARD, gustSpeed_kmh: 260 },
      new Date('2026-03-01T00:00:00.000Z'),
    )
    useDesignStore.getState().loadDesign(design)

    const state = useDesignStore.getState()
    // "What did my changes do", not "how does this differ from a default the
    // person who sent it never saw".
    expect(state.baseline.label).toBe('Coastal block')
    expect(state.baseline.structure).toBe(state.structure)
    expect(state.baseline.hazard.gustSpeed_kmh).toBe(260)
  })

  it('goes back to the starting design on resetBaseline, leaving the design alone', () => {
    useDesignStore.getState().setGustSpeed(240)
    useDesignStore.getState().pinBaseline()
    useDesignStore.getState().resetBaseline()

    const state = useDesignStore.getState()
    expect(state.baseline).toBe(STARTING_BASELINE)
    expect(state.hazard.gustSpeed_kmh).toBe(240)
  })

  it('goes back to the starting design on a full reset', () => {
    useDesignStore.getState().pinBaseline()
    useDesignStore.getState().reset()
    expect(useDesignStore.getState().baseline).toBe(STARTING_BASELINE)
  })
})
