/**
 * Written from the attacker's side, like `ai/guard.test.ts` and
 * `persistence/schema.test.ts`: what could a model propose that is wrong, or
 * misleading, and still land on a student's screen as a building?
 *
 * The property the whole module exists for is at the bottom — anything
 * `parseBlueprint` accepts, `analyze()` can run.
 */

import { describe, expect, it } from 'vitest'
import { analyze, MATERIAL_LIBRARY, type Structure } from '@/engine'
import {
  PLAN_WIDTH_LIMITS_M,
  STOREY_COUNT_LIMITS,
  STOREY_HEIGHT_LIMITS_M,
} from '@/lib/limits.ts'
import { BLUEPRINT_CAVEATS, caveatText } from './types.ts'
import {
  BlueprintParseError,
  parseBlueprint,
  requiredCaveats,
  type Blueprint,
} from './parse.ts'

/** A reply a well-behaved model produces. Individual tests bend one field. */
function reply(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'Arena shell',
    typology: 'custom',
    storeyCount: 3,
    storeyHeight_m: 7,
    widthX_m: 58,
    widthY_m: 44,
    taper: 0,
    materialId: 'structural-steel',
    lateralSystem: 'braced-frame',
    facade: 'punched', planShape: 'rectangle',
    foundationType: 'raft',
    embedmentDepth_m: 1.5,
    anchorCapacity_kN: 1400,
    exposureCategory: 'C',
    interpretation: 'A wide steel box 58 m across, the footprint of an arena.',
    notes: 'Steel because the spans are long.',
    caveats: ['long-span-roof'],
    ...overrides,
  })
}

/** The store's job, reproduced here so the property test can call analyze(). */
function structureOf(blueprint: Blueprint): Structure {
  return {
    typology: blueprint.typology,
    storeys: blueprint.storeys,
    foundation: {
      type: blueprint.foundationType,
      embedmentDepth_m: blueprint.embedmentDepth_m,
      anchorCapacity_kN: blueprint.anchorCapacity_kN,
    },
    exposureCategory: blueprint.exposureCategory,
  }
}

describe('parseBlueprint', () => {
  it('reads a well-formed proposal', () => {
    const blueprint = parseBlueprint(reply(), 'an arena')
    expect(blueprint.name).toBe('Arena shell')
    expect(blueprint.storeys).toHaveLength(3)
    expect(blueprint.storeys[0]?.materialId).toBe('structural-steel')
    // No sections: the typical storey, repeated.
    expect(new Set(blueprint.storeys.map((s) => s.height_m)).size).toBe(1)
    expect(blueprint.adjustments).toEqual([])
  })

  it('recovers JSON from a chatty reply, as the critique parser does', () => {
    const blueprint = parseBlueprint(
      `Sure! Here is the design:\n\`\`\`json\n${reply()}\n\`\`\`\nHope that helps.`,
      'an arena',
    )
    expect(blueprint.storeys[0]?.materialId).toBe('structural-steel')
  })

  it('refuses a material that is not in the library, by name', () => {
    expect(() => parseBlueprint(reply({ materialId: 'carbon-fibre' }), 'a tower')).toThrow(
      /carbon-fibre/,
    )
    // Refused, not substituted: a design built out of something else would give
    // the student a carbon figure for a building they did not ask for.
    expect(() => parseBlueprint(reply({ materialId: 'carbon-fibre' }), 'a tower')).toThrow(
      BlueprintParseError,
    )
  })

  it('refuses an invented lateral system, facade or foundation', () => {
    for (const field of ['lateralSystem', 'facade', 'foundationType'] as const) {
      expect(() => parseBlueprint(reply({ [field]: 'tensegrity' }), 'a tower')).toThrow(
        BlueprintParseError,
      )
    }
  })

  it('refuses a missing or non-numeric dimension rather than assuming one', () => {
    // Clamping an absent storey count to the minimum would quietly hand back a
    // one-storey building nobody asked for.
    expect(() => parseBlueprint(reply({ storeyCount: undefined }), 'a tower')).toThrow(
      BlueprintParseError,
    )
    expect(() => parseBlueprint(reply({ widthX_m: '58' }), 'a tower')).toThrow(
      /widthX_m|width/,
    )
  })

  it('pulls an out-of-range number to the edge and says so', () => {
    const blueprint = parseBlueprint(reply({ storeyCount: 40 }), 'a very tall tower')
    expect(blueprint.storeys).toHaveLength(STOREY_COUNT_LIMITS.max)
    expect(blueprint.adjustments.join(' ')).toMatch(/40/)
    expect(blueprint.adjustments.join(' ')).toMatch(String(STOREY_COUNT_LIMITS.max))
  })

  it('keeps every number inside the editing limits', () => {
    const blueprint = parseBlueprint(
      reply({ storeyHeight_m: 40, widthX_m: 900, widthY_m: 0.5, taper: 9 }),
      'a hangar',
    )
    const ground = blueprint.storeys[0]
    expect(ground?.height_m).toBeLessThanOrEqual(STOREY_HEIGHT_LIMITS_M.max)
    expect(ground?.widthX_m).toBeLessThanOrEqual(PLAN_WIDTH_LIMITS_M.max)
    expect(ground?.widthY_m).toBeGreaterThanOrEqual(PLAN_WIDTH_LIMITS_M.min)
    expect(blueprint.taper).toBeLessThanOrEqual(0.6)
    expect(blueprint.adjustments).toHaveLength(4)
  })

  it('falls back to the documented defaults for exposure and typology', () => {
    const blueprint = parseBlueprint(
      reply({ exposureCategory: 'Z', typology: 'stadium' }),
      'a stadium',
    )
    // 'C' is the engine's own default and 'custom' is defined as the absence of
    // a claim, so both are honest; both are reported.
    expect(blueprint.exposureCategory).toBe('C')
    expect(blueprint.typology).toBe('custom')
    expect(blueprint.adjustments).toHaveLength(2)
  })

  it('takes a round plan when the model asks for one', () => {
    const blueprint = parseBlueprint(reply({ planShape: 'ellipse' }), 'a round tower')
    expect(blueprint.storeys.every((s) => s.planShape === 'ellipse')).toBe(true)
    expect(blueprint.adjustments).toEqual([])
  })

  it('defaults a missing footprint to the rectangle, silently no more', () => {
    // Every design in this app was a rectangle before footprints existed, and
    // an old saved one migrates to exactly that — so it is the honest absence.
    const blueprint = parseBlueprint(reply({ planShape: undefined }), 'a house')
    expect(blueprint.storeys[0]?.planShape).toBe('rectangle')
  })

  it('reports a footprint it does not have rather than guessing', () => {
    const blueprint = parseBlueprint(reply({ planShape: 'hexagon' }), 'a tower')
    expect(blueprint.storeys[0]?.planShape).toBe('rectangle')
    expect(blueprint.adjustments.join(' ')).toMatch(/hexagon/)
  })

  it('lets one section be round and another square', () => {
    const blueprint = parseBlueprint(
      reply({
        planShape: 'ellipse',
        sections: [
          { count: 1, widthX_m: 50, widthY_m: 50, planShape: 'rectangle' },
          { count: 2, widthX_m: 24, widthY_m: 24 },
        ],
      }),
      'a tower on a podium',
    )
    expect(blueprint.storeys[0]?.planShape).toBe('rectangle')
    expect(blueprint.storeys[1]?.planShape).toBe('ellipse')
  })

  it('drops a caveat id this build has no text for', () => {
    const blueprint = parseBlueprint(reply({ caveats: ['made-up-caveat'] }), 'a house')
    expect(blueprint.caveats).toEqual([])
  })

  it('adds the caveats the request implies even when the model cites none', () => {
    const blueprint = parseBlueprint(reply({ caveats: [] }), 'an arena for 20,000 people')
    expect(blueprint.caveats).toContain(caveatText('long-span-roof'))
    expect(blueprint.caveats).toContain(caveatText('uplift'))
    expect(blueprint.caveats).toContain(caveatText('occupancy-load'))
  })

  it('flags a predicted result in the prose', () => {
    // The one thing a proposal must never do: state a number the engine has not
    // produced. Caught by the same guard the critique goes through.
    const blueprint = parseBlueprint(
      reply({
        notes: 'This will comfortably reach a safety factor of 2.4 and cost $4,200,000.',
      }),
      'a tower',
    )
    const flagged = blueprint.unverified.map((figure) => figure.text).join(' ')
    expect(flagged).toMatch(/2\.4/)
    expect(flagged).toMatch(/4,200,000/)
  })

  it('lets the prose restate the dimensions it chose', () => {
    const blueprint = parseBlueprint(
      reply({ interpretation: 'A box 58 m by 44 m, three floors of 7 m.' }),
      'an arena',
    )
    expect(blueprint.unverified).toEqual([])
  })

  it('refuses a reply with no JSON in it at all', () => {
    expect(() => parseBlueprint('I cannot help with that.', 'a house')).toThrow(
      BlueprintParseError,
    )
  })

  it('truncates an over-long name rather than rejecting the design', () => {
    const blueprint = parseBlueprint(reply({ name: 'A'.repeat(200) }), 'a house')
    expect(blueprint.name.length).toBeLessThanOrEqual(60)
    expect(blueprint.adjustments).toHaveLength(1)
  })

  describe('sections', () => {
    /** An arena as the engine can actually hold it: a hall, then two tiers. */
    const sections = [
      { count: 1, height_m: 8, widthX_m: 58, widthY_m: 44 },
      { count: 2, height_m: 4, widthX_m: 44, widthY_m: 34, facade: 'ribbon' },
    ]

    it('expands into storeys bottom to top, inheriting what it omits', () => {
      const blueprint = parseBlueprint(reply({ sections }), 'an arena')
      expect(blueprint.storeys).toHaveLength(3)
      expect(blueprint.storeys[0]).toMatchObject({
        height_m: 8,
        widthX_m: 58,
        facade: 'punched', planShape: 'rectangle',
        // Not stated in the section, so inherited from the typical storey.
        materialId: 'structural-steel',
        lateralSystem: 'braced-frame',
      })
      expect(blueprint.storeys[1]).toMatchObject({ height_m: 4, widthX_m: 44, facade: 'ribbon' })
      expect(blueprint.storeys[2]?.height_m).toBe(4)
    })

    it('ignores storeyCount once sections describe the stack', () => {
      const blueprint = parseBlueprint(reply({ sections, storeyCount: 12 }), 'an arena')
      expect(blueprint.storeys).toHaveLength(3)
    })

    it('refuses an invented material inside a section, by name', () => {
      expect(() =>
        parseBlueprint(
          reply({ sections: [{ count: 2, materialId: 'unobtainium' }] }),
          'a tower',
        ),
      ).toThrow(/unobtainium/)
    })

    it('clamps a section that is out of range and says so', () => {
      const blueprint = parseBlueprint(
        reply({ sections: [{ count: 1, height_m: 40 }, { count: 1 }] }),
        'a hall',
      )
      expect(blueprint.storeys[0]?.height_m).toBe(STOREY_HEIGHT_LIMITS_M.max)
      expect(blueprint.adjustments).toHaveLength(1)
    })

    it('stops at the storey limit rather than overflowing it', () => {
      const blueprint = parseBlueprint(
        reply({ sections: [{ count: 20 }, { count: 20 }] }),
        'a very tall tower',
      )
      expect(blueprint.storeys).toHaveLength(STOREY_COUNT_LIMITS.max)
      expect(blueprint.adjustments.join(' ')).toMatch(/stops at 24/)
    })

    it('falls back to the typical storey when the list is empty', () => {
      const blueprint = parseBlueprint(reply({ sections: [] }), 'a house')
      expect(blueprint.storeys).toHaveLength(3)
    })

    it('refuses a section that is not an object', () => {
      expect(() => parseBlueprint(reply({ sections: ['a big hall'] }), 'a hall')).toThrow(
        BlueprintParseError,
      )
    })

    it('lets the prose restate any section dimension', () => {
      const blueprint = parseBlueprint(
        reply({
          sections,
          interpretation: 'An 8 m hall, 58 m across, with two 4 m tiers over it.',
        }),
        'an arena',
      )
      expect(blueprint.unverified).toEqual([])
    })
  })

  it('produces a design the engine can analyse — the point of the module', () => {
    const cases: ReadonlyArray<[string, Record<string, unknown>]> = [
      ['an arena', {}],
      ['a 40 storey tower', { storeyCount: 40, materialId: 'reinforced-concrete' }],
      ['a shed', { storeyCount: 1, storeyHeight_m: 0.5, widthY_m: 0.1, taper: 5 }],
      ['a rammed earth house', { materialId: 'rammed-earth', lateralSystem: 'shear-wall' }],
      ['a round observation tower', { planShape: 'ellipse', storeyCount: 20, widthX_m: 14, widthY_m: 14 }],
      [
        'an arena',
        {
          sections: [
            { count: 1, height_m: 8, widthX_m: 58, widthY_m: 44 },
            { count: 3, height_m: 3.5, widthX_m: 30, widthY_m: 24 },
          ],
        },
      ],
    ]
    for (const [description, overrides] of cases) {
      const blueprint = parseBlueprint(reply(overrides), description)
      const result = analyze(
        structureOf(blueprint),
        { kind: 'wind', gustSpeed_kmh: 150, directionDeg: 0, terrainRoughness: 0.02 },
        MATERIAL_LIBRARY,
      )
      expect(Number.isFinite(result.stability.baseShear_kN)).toBe(true)
    }
  })
})

describe('requiredCaveats', () => {
  it('every id it can return has text in the table', () => {
    const known = new Set(BLUEPRINT_CAVEATS.map((entry) => entry.id))
    const probes = [
      'an arena',
      'a stadium with an open end',
      'a suspension bridge',
      'a round observation tower',
      'a grandstand with cantilevered seating',
      'an aircraft hangar',
      'a cathedral',
      'a house',
    ]
    for (const probe of probes) {
      for (const id of requiredCaveats(probe)) expect(known.has(id)).toBe(true)
    }
  })

  it('says nothing about an ordinary building', () => {
    expect(requiredCaveats('a three storey brick house')).toEqual([])
  })

  it('calls a bridge what it is', () => {
    expect(requiredCaveats('a cable-stayed bridge')).toContain('not-a-building')
  })
})
