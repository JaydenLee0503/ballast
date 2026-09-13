/**
 * The parts of the store with behaviour rather than assignment, which is
 * where the bugs are: the baseline, which follows a design that gets opened,
 * and the taper, which generates every storey's plan from two numbers and has
 * to keep doing so as storeys are added and widths are dragged.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { analyze, MATERIAL_LIBRARY, type Hazard } from '@/engine'
import { parseBlueprint } from '@/ai/blueprint/parse.ts'
import { createSavedDesign } from '@/persistence'
import {
  PLAN_WIDTH_LIMITS_M,
  SEISMIC_S1_LIMITS_G,
  SEISMIC_SS_LIMITS_G,
  STOREY_HEIGHT_LIMITS_M,
  TAPER_LIMITS,
} from '@/lib/limits.ts'
import {
  DEFAULT_HAZARD,
  DEFAULT_STRUCTURE,
  deriveTaper,
  STARTING_BASELINE,
  useDesignStore,
} from './design.ts'

/**
 * The gust speed of a hazard a test has kept on the wind branch.
 *
 * `hazard` is the union now, so reading a wind field off it needs narrowing.
 * Throwing rather than returning a fallback: a test that lands here under the
 * wrong hazard has stopped testing what it says it tests.
 */
function gustSpeed(hazard: Hazard): number {
  if (hazard.kind !== 'wind') {
    throw new Error(`expected a wind hazard, got ${hazard.kind}`)
  }
  return hazard.gustSpeed_kmh
}

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
    expect(gustSpeed(state.baseline.hazard)).toBe(240)
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
    expect(gustSpeed(state.baseline.hazard)).toBe(260)
  })

  it('goes back to the starting design on resetBaseline, leaving the design alone', () => {
    useDesignStore.getState().setGustSpeed(240)
    useDesignStore.getState().pinBaseline()
    useDesignStore.getState().resetBaseline()

    const state = useDesignStore.getState()
    expect(state.baseline).toBe(STARTING_BASELINE)
    expect(gustSpeed(state.hazard)).toBe(240)
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

describe('applyBlueprint', () => {
  /** A reply of the shape the model is asked for; the parser has checked it. */
  const arena = () =>
    parseBlueprint(
      JSON.stringify({
        name: 'Arena shell',
        typology: 'custom',
        storeyCount: 3,
        storeyHeight_m: 7.5,
        widthX_m: 58,
        widthY_m: 44,
        taper: 0.2,
        materialId: 'structural-steel',
        lateralSystem: 'braced-frame',
        facade: 'punched', planShape: 'rectangle',
        foundationType: 'raft',
        embedmentDepth_m: 1.5,
        anchorCapacity_kN: 1400,
        exposureCategory: 'C',
        interpretation: 'A wide steel box.',
        notes: 'Steel, because the spans are long.',
        caveats: ['long-span-roof'],
      }),
      'an arena',
    )

  /** The same reply, but describing a hall with two tiers over it. */
  const sectionedArena = () =>
    parseBlueprint(
      JSON.stringify({
        name: 'Arena',
        typology: 'custom',
        storeyCount: 3,
        storeyHeight_m: 4,
        widthX_m: 44,
        widthY_m: 34,
        taper: 0.4,
        materialId: 'structural-steel',
        lateralSystem: 'braced-frame',
        facade: 'punched', planShape: 'rectangle',
        foundationType: 'raft',
        embedmentDepth_m: 1.5,
        anchorCapacity_kN: 1400,
        exposureCategory: 'C',
        sections: [
          { count: 1, height_m: 8, widthX_m: 58, widthY_m: 44 },
          { count: 2 },
        ],
        interpretation: 'A hall with two tiers.',
        notes: '',
        caveats: [],
      }),
      'an arena',
    )

  it('writes an ordinary structure the engine can analyse', () => {
    useDesignStore.getState().applyBlueprint(arena())
    const { structure, hazard } = useDesignStore.getState()
    expect(structure.storeys).toHaveLength(3)
    expect(structure.storeys[0]?.materialId).toBe('structural-steel')
    expect(analyze(structure, hazard, MATERIAL_LIBRARY).scoreCard.carbonKg).toBeGreaterThan(0)
  })

  it('generates the widths from the taper it was given', () => {
    useDesignStore.getState().applyBlueprint(arena())
    expect(useDesignStore.getState().taper).toBeCloseTo(0.2)
    // Top storey at 80% of the base, the same rule every taper drag follows.
    expect(widths()[2]).toBeCloseTo(58 * 0.8, 1)
  })

  it('becomes the baseline, so the next edit is measured against it', () => {
    useDesignStore.getState().applyBlueprint(arena())
    const { structure, baseline } = useDesignStore.getState()
    expect(baseline.label).toBe('Arena shell')
    // The same object, so the first reading shows no change at all.
    expect(baseline.structure).toBe(structure)
  })

  it('leaves the storm alone', () => {
    useDesignStore.getState().setGustSpeed(240)
    useDesignStore.getState().applyBlueprint(arena())
    expect(gustSpeed(useDesignStore.getState().hazard)).toBe(240)
  })

  it('keeps a sectioned stack exactly as proposed', () => {
    useDesignStore.getState().applyBlueprint(sectionedArena())
    const storeys = useDesignStore.getState().structure.storeys
    expect(storeys).toHaveLength(3)
    // The tall hall survives, and so do its widths: a taper across two sizes
    // would have regenerated all three storeys from the ground one.
    expect(storeys[0]).toMatchObject({ height_m: 8, widthX_m: 58, widthY_m: 44 })
    expect(storeys[1]).toMatchObject({ height_m: 4, widthX_m: 44 })
    expect(storeys[2]).toMatchObject({ height_m: 4, widthX_m: 44 })
  })

  it('shows the taper the sectioned stack actually has, not the proposed one', () => {
    useDesignStore.getState().applyBlueprint(sectionedArena())
    // The proposal said 0.4, but its own sections say 44/58, so the control
    // describes what is on screen. Same rule loadDesign follows.
    expect(useDesignStore.getState().taper).toBeCloseTo(1 - 44 / 58, 2)
  })
})

describe('shaping one storey', () => {
  it('sizes only the selected storey', () => {
    useDesignStore.getState().setPlanDimensions(30, 30, 2)
    const storeys = useDesignStore.getState().structure.storeys
    expect(storeys[2]).toMatchObject({ widthX_m: 30, widthY_m: 30 })
    expect(storeys[1]?.widthX_m).toBe(DEFAULT_STRUCTURE.storeys[1]?.widthX_m)
  })

  it('heightens only the selected storey', () => {
    useDesignStore.getState().setStoreyHeight(8, 0)
    const storeys = useDesignStore.getState().structure.storeys
    expect(storeys[0]?.height_m).toBe(8)
    expect(storeys[1]?.height_m).toBe(DEFAULT_STRUCTURE.storeys[1]?.height_m)
  })

  it('re-reads the taper off a stack it no longer generated', () => {
    useDesignStore.getState().setPlanDimensions(9, 9, 5)
    // The top storey is now half the base, so the control says so rather than
    // going on claiming the stack is prismatic.
    expect(useDesignStore.getState().taper).toBeCloseTo(0.5, 2)
  })

  it('does not let Add flatten a hand-shaped stack', () => {
    useDesignStore.getState().setPlanDimensions(8, 8, 3)
    const before = widths()
    useDesignStore.getState().addStorey()
    // The storeys that existed keep their widths; only a stack the taper
    // generated gets regenerated when the count changes.
    expect(widths().slice(0, before.length)).toEqual(before)
  })

  it('still re-tapers a stack the taper did generate', () => {
    useDesignStore.getState().setTaper(0.4)
    const before = widths()
    useDesignStore.getState().addStorey()
    const after = widths()
    expect(after).toHaveLength(before.length + 1)
    // Spread across the new count, so the top is still (1 - taper) of the base.
    expect((after[after.length - 1] ?? 0) / (after[0] ?? 1)).toBeCloseTo(0.6, 2)
  })
})

describe('storey height', () => {
  it('sets every storey at once, and stays inside the limits', () => {
    useDesignStore.getState().setStoreyHeight(7.5)
    for (const storey of useDesignStore.getState().structure.storeys) {
      expect(storey.height_m).toBe(7.5)
    }
    useDesignStore.getState().setStoreyHeight(500)
    expect(useDesignStore.getState().structure.storeys[0]?.height_m).toBe(
      STOREY_HEIGHT_LIMITS_M.max,
    )
  })

  it('does not disturb the plan', () => {
    const before = widths()
    useDesignStore.getState().setStoreyHeight(4)
    expect(widths()).toEqual(before)
  })
})

/**
 * Switching hazards. The one rule the whole feature rests on is that changing
 * the event does not change the design: the point of three hazards is that the
 * same building meets all three and they disagree about it.
 */
describe('the hazard', () => {
  it('starts as the storm the studio opens with', () => {
    expect(useDesignStore.getState().hazard).toBe(DEFAULT_HAZARD)
  })

  it('leaves the structure completely alone when it changes', () => {
    const before = useDesignStore.getState().structure
    useDesignStore.getState().setHazardKind('seismic')
    expect(useDesignStore.getState().structure).toBe(before)
    useDesignStore.getState().setHazardKind('flood')
    expect(useDesignStore.getState().structure).toBe(before)
  })

  it('remembers what each hazard was set to', () => {
    useDesignStore.getState().setGustSpeed(265)
    useDesignStore.getState().setHazardKind('flood')
    useDesignStore.getState().setFloodDepth(4.5)
    useDesignStore.getState().setHazardKind('wind')

    const wind = useDesignStore.getState().hazard
    expect(wind.kind).toBe('wind')
    expect(wind.kind === 'wind' && wind.gustSpeed_kmh).toBe(265)

    useDesignStore.getState().setHazardKind('flood')
    const flood = useDesignStore.getState().hazard
    expect(flood.kind === 'flood' && flood.depth_m).toBe(4.5)
  })

  it('ignores a setter for a hazard that is not selected', () => {
    useDesignStore.getState().setHazardKind('seismic')
    const before = useDesignStore.getState().hazard
    useDesignStore.getState().setGustSpeed(300)
    useDesignStore.getState().setFloodDepth(9)
    expect(useDesignStore.getState().hazard).toBe(before)
  })

  it('sets a bearing on whichever hazard is live', () => {
    useDesignStore.getState().setHazardKind('flood')
    useDesignStore.getState().setDirection(450)
    expect(useDesignStore.getState().hazard.directionDeg).toBe(90)
  })

  it('clamps to the editing limits, like every other control', () => {
    useDesignStore.getState().setHazardKind('seismic')
    useDesignStore.getState().setSeismicAcceleration(99, -4)
    const hazard = useDesignStore.getState().hazard
    expect(hazard.kind === 'seismic' && hazard.Ss_g).toBe(SEISMIC_SS_LIMITS_G.max)
    expect(hazard.kind === 'seismic' && hazard.S1_g).toBe(SEISMIC_S1_LIMITS_G.min)
  })

  it('hands analyze() something it can run, whichever one is picked', () => {
    for (const kind of ['wind', 'seismic', 'flood'] as const) {
      useDesignStore.getState().setHazardKind(kind)
      const { structure, hazard } = useDesignStore.getState()
      expect(analyze(structure, hazard, MATERIAL_LIBRARY).hazardKind).toBe(kind)
    }
  })

  it('is what the deltas are measured against, so switching shows a change', () => {
    // The baseline holds the storm the design was pinned under. Switching the
    // hazard therefore reads as a change, which is the honest answer: this is
    // not the same question being asked of the same building.
    const { baseline } = useDesignStore.getState()
    useDesignStore.getState().setHazardKind('seismic')
    expect(useDesignStore.getState().hazard).not.toBe(baseline.hazard)
  })
})
