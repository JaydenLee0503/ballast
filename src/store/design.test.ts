/**
 * The parts of the store with behaviour rather than assignment, which is
 * where the bugs are: the baseline, which follows a design that gets opened,
 * and the taper, which generates every storey's plan from two numbers and has
 * to keep doing so as storeys are added and widths are dragged.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createSavedDesign } from '@/persistence'
import { PLAN_WIDTH_LIMITS_M, TAPER_LIMITS } from '@/lib/limits.ts'
import {
  DEFAULT_HAZARD,
  DEFAULT_STRUCTURE,
  deriveTaper,
  STARTING_BASELINE,
  useDesignStore,
} from './design.ts'

const widths = () =>
  useDesignStore.getState().structure.storeys.map((storey) => storey.widthX_m)

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

describe('taper', () => {
  it('starts prismatic: every storey the same plan', () => {
    expect(new Set(widths()).size).toBe(1)
    expect(useDesignStore.getState().taper).toBe(0)
  })

  it('narrows monotonically upward, base unchanged', () => {
    const base = widths()[0]
    useDesignStore.getState().setTaper(0.4)
    const tapered = widths()

    expect(tapered[0]).toBe(base)
    for (let i = 1; i < tapered.length; i += 1) {
      const above = tapered[i]
      const below = tapered[i - 1]
      if (above === undefined || below === undefined) throw new Error('no storey')
      expect(above).toBeLessThan(below)
    }
  })

  it('puts the top storey at (1 - taper) of the base', () => {
    useDesignStore.getState().setTaper(0.5)
    const all = widths()
    const base = all[0]
    const top = all[all.length - 1]
    if (base === undefined || top === undefined) throw new Error('no storeys')
    expect(top / base).toBeCloseTo(0.5, 2)
  })

  it('survives a width drag rather than being flattened by it', () => {
    useDesignStore.getState().setTaper(0.4)
    useDesignStore.getState().setPlanDimensions(30, 30)
    const all = widths()
    expect(all[0]).toBe(30)
    expect(new Set(all).size).toBeGreaterThan(1)
  })

  it('does not drift as the width is dragged back and forth', () => {
    useDesignStore.getState().setTaper(0.4)
    const before = widths()
    for (const width of [24, 40, 12, 18]) {
      useDesignStore.getState().setPlanDimensions(width, 12)
    }
    useDesignStore.getState().setPlanDimensions(18, 12)
    // Regenerated from (base, taper) every time, never scaled from what was
    // already there, so a dozen drags cannot accumulate rounding.
    expect(widths()).toEqual(before)
  })

  it('re-applies itself to storeys added afterwards', () => {
    useDesignStore.getState().setTaper(0.4)
    useDesignStore.getState().addStorey()
    const all = widths()
    const top = all[all.length - 1]
    const below = all[all.length - 2]
    if (top === undefined || below === undefined) throw new Error('no storeys')
    expect(top).toBeLessThan(below)
    expect(all[0]).toBe(DEFAULT_STRUCTURE.storeys[0]?.widthX_m)
  })

  it('never generates a plan the parser would refuse', () => {
    useDesignStore.getState().setPlanDimensions(PLAN_WIDTH_LIMITS_M.min, PLAN_WIDTH_LIMITS_M.min)
    useDesignStore.getState().setTaper(TAPER_LIMITS.max)
    for (const width of widths()) {
      expect(width).toBeGreaterThanOrEqual(PLAN_WIDTH_LIMITS_M.min)
      expect(width).toBeLessThanOrEqual(PLAN_WIDTH_LIMITS_M.max)
    }
  })

  it('is clamped, not trusted', () => {
    useDesignStore.getState().setTaper(5)
    expect(useDesignStore.getState().taper).toBe(TAPER_LIMITS.max)
    useDesignStore.getState().setTaper(Number.NaN)
    expect(useDesignStore.getState().taper).toBe(TAPER_LIMITS.min)
  })

  it('is read back off a design that was opened, not left where it was', () => {
    useDesignStore.getState().setTaper(0.4)
    const design = createSavedDesign(
      'Straight-sided',
      DEFAULT_STRUCTURE,
      DEFAULT_HAZARD,
      new Date('2026-03-01T12:00:00.000Z'),
    )
    useDesignStore.getState().loadDesign(design)
    expect(useDesignStore.getState().taper).toBe(0)
    expect(deriveTaper(DEFAULT_STRUCTURE)).toBe(0)
  })
})

describe('facade', () => {
  it('sets every storey at once', () => {
    useDesignStore.getState().setAllFacade('curtain-wall')
    for (const storey of useDesignStore.getState().structure.storeys) {
      expect(storey.facade).toBe('curtain-wall')
    }
  })

  it('sets one storey without touching the rest', () => {
    useDesignStore.getState().setAllFacade('punched')
    useDesignStore.getState().setStoreyFacade(0, 'curtain-wall')
    const storeys = useDesignStore.getState().structure.storeys
    expect(storeys[0]?.facade).toBe('curtain-wall')
    expect(storeys[1]?.facade).toBe('punched')
  })

  it('replaces the structure rather than mutating it', () => {
    const before = useDesignStore.getState().structure
    useDesignStore.getState().setAllFacade('ribbon')
    expect(useDesignStore.getState().structure).not.toBe(before)
    expect(before.storeys[0]?.facade).toBe('punched')
  })
})
