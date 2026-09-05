/**
 * Written from the attacker's side, like the AI guard tests: what could be in
 * a stored blob or a pasted URL that would break the app if it got through?
 *
 * The last test is the one that matters most — it asserts the property the
 * whole module exists for, that anything `parseDesign` accepts is something
 * `analyze()` can run. If a new field escapes validation, that test is the one
 * that should notice.
 */

import { describe, expect, it } from 'vitest'
import { analyze, MATERIAL_LIBRARY } from '@/engine'
import { DEFAULT_HAZARD, DEFAULT_STRUCTURE } from '@/store/design.ts'
import {
  createSavedDesign,
  DESIGN_SCHEMA_VERSION,
  DesignParseError,
  MAX_NAME_LENGTH,
  parseDesign,
  parseDesignJson,
  serializeDesign,
} from './schema.ts'

const SAVED_AT = new Date('2026-03-01T12:00:00.000Z')

function validDesign() {
  return createSavedDesign('Baseline CLT', DEFAULT_STRUCTURE, DEFAULT_HAZARD, SAVED_AT)
}

/** A plain-JSON copy, so a test can corrupt one field without typing all of them. */
function corrupt(mutate: (design: Record<string, any>) => void): unknown {
  const raw = JSON.parse(serializeDesign(validDesign())) as Record<string, any>
  mutate(raw)
  return raw
}

function parse(raw: unknown) {
  return parseDesign(raw, MATERIAL_LIBRARY)
}

describe('round trip', () => {
  it('survives serialize -> parse unchanged', () => {
    const design = validDesign()
    expect(parseDesignJson(serializeDesign(design), MATERIAL_LIBRARY)).toEqual(design)
  })

  it('stamps the current schema version and the supplied clock', () => {
    const design = validDesign()
    expect(design.schemaVersion).toBe(DESIGN_SCHEMA_VERSION)
    expect(design.savedAt).toBe('2026-03-01T12:00:00.000Z')
  })

  it('trims the name', () => {
    expect(createSavedDesign('  Tower  ', DEFAULT_STRUCTURE, DEFAULT_HAZARD, SAVED_AT).name)
      .toBe('Tower')
  })
})

describe('version', () => {
  it('refuses a version it does not know, naming both', () => {
    expect(() => parse(corrupt((d) => { d['schemaVersion'] = 2 })))
      .toThrow(/unsupported schemaVersion 2.*version 1/s)
  })

  it('refuses a missing version rather than assuming the current one', () => {
    expect(() => parse(corrupt((d) => { delete d['schemaVersion'] })))
      .toThrow(DesignParseError)
  })
})

describe('materials', () => {
  it('refuses an unknown material by name instead of substituting one', () => {
    const raw = corrupt((d) => { d['structure'].storeys[2].materialId = 'unobtainium' })
    expect(() => parse(raw)).toThrow(/storeys\[2\].materialId "unobtainium"/)
  })

  it('accepts every material the library actually ships', () => {
    for (const material of MATERIAL_LIBRARY.values()) {
      const raw = corrupt((d) => {
        for (const storey of d['structure'].storeys) storey.materialId = material.id
      })
      expect(() => parse(raw)).not.toThrow()
    }
  })
})

describe('enumerated fields', () => {
  it.each([
    ['structure.storeys[0].lateralSystem', (d: any) => { d.structure.storeys[0].lateralSystem = 'tensegrity' }],
    ['structure.exposureCategory', (d: any) => { d.structure.exposureCategory = 'E' }],
    ['structure.foundation.type', (d: any) => { d.structure.foundation.type = 'floating' }],
  ])('refuses an out-of-union %s', (_label, mutate) => {
    expect(() => parse(corrupt(mutate))).toThrow(DesignParseError)
  })

  it('refuses a hazard kind this build cannot analyse', () => {
    expect(() => parse(corrupt((d) => { d['hazard'].kind = 'seismic' })))
      .toThrow(/not a hazard this build can analyse/)
  })
})

describe('numeric bounds', () => {
  it.each([
    ['zero storeys', (d: any) => { d.structure.storeys = [] }],
    ['too many storeys', (d: any) => {
      d.structure.storeys = Array.from({ length: 25 }, () => ({ ...d.structure.storeys[0] }))
    }],
    ['negative width', (d: any) => { d.structure.storeys[0].widthX_m = -18 }],
    ['absurd storey height', (d: any) => { d.structure.storeys[0].height_m = 5000 }],
    ['NaN gust speed', (d: any) => { d.hazard.gustSpeed_kmh = Number.NaN }],
    ['gust speed past the slider', (d: any) => { d.hazard.gustSpeed_kmh = 1e6 }],
    ['negative anchor capacity', (d: any) => { d.structure.foundation.anchorCapacity_kN = -1 }],
    ['zero terrain roughness', (d: any) => { d.hazard.terrainRoughness = 0 }],
    ['numeric string width', (d: any) => { d.structure.storeys[0].widthX_m = '18' }],
  ])('refuses %s', (_label, mutate) => {
    expect(() => parse(corrupt(mutate))).toThrow(DesignParseError)
  })

  it('wraps a bearing rather than refusing it, matching the store', () => {
    expect(parse(corrupt((d) => { d['hazard'].directionDeg = 370 })).hazard.directionDeg).toBe(10)
    expect(parse(corrupt((d) => { d['hazard'].directionDeg = -90 })).hazard.directionDeg).toBe(270)
  })
})

describe('names', () => {
  it.each([
    ['blank', '   '],
    ['empty', ''],
    ['overlong', 'x'.repeat(MAX_NAME_LENGTH + 1)],
  ])('refuses a %s name', (_label, name) => {
    expect(() => parse(corrupt((d) => { d['name'] = name }))).toThrow(DesignParseError)
  })

  it('refuses a non-string name', () => {
    expect(() => parse(corrupt((d) => { d['name'] = 42 }))).toThrow(DesignParseError)
  })
})

describe('shape', () => {
  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'design'],
    ['a number', 7],
  ])('refuses %s at the top level', (_label, raw) => {
    expect(() => parse(raw)).toThrow(DesignParseError)
  })

  it('reports malformed JSON as a parse error, not a SyntaxError', () => {
    expect(() => parseDesignJson('{not json', MATERIAL_LIBRARY)).toThrow(DesignParseError)
  })

  it('drops properties that are not part of the schema', () => {
    const parsed = parse(corrupt((d) => {
      d['injected'] = 'should not survive'
      d['structure'].storeys[0].injected = 'nor this'
    })) as unknown as Record<string, unknown>
    expect(parsed['injected']).toBeUndefined()
    expect(Object.keys(parsed.structure as object)).toEqual([
      'storeys', 'foundation', 'exposureCategory',
    ])
    expect(Object.keys((parsed.structure as any).storeys[0])).toEqual([
      'height_m', 'widthX_m', 'widthY_m', 'materialId', 'lateralSystem',
    ])
  })
})

describe('the property the module exists for', () => {
  it('hands analyze() something it can run, for every accepted design', () => {
    const variants: Array<(d: any) => void> = [
      () => {},
      (d) => { d.structure.storeys = [d.structure.storeys[0]] },
      (d) => { d.hazard.gustSpeed_kmh = 0 },
      (d) => { d.hazard.directionDeg = 90 },
      (d) => { d.structure.foundation.anchorCapacity_kN = 0 },
      (d) => { d.structure.foundation.embedmentDepth_m = 0 },
      (d) => { d.structure.exposureCategory = 'D' },
      (d) => { for (const s of d.structure.storeys) s.lateralSystem = 'none' },
    ]
    for (const mutate of variants) {
      const design = parse(corrupt(mutate))
      expect(() => analyze(design.structure, design.hazard, MATERIAL_LIBRARY)).not.toThrow()
    }
  })
})
