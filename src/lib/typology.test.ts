import { expect, it } from 'vitest'
import { MATERIAL_LIBRARY, analyze, type WindHazard } from '@/engine'
import {
  PLAN_WIDTH_LIMITS_M,
  STOREY_COUNT_LIMITS,
  STOREY_HEIGHT_LIMITS_M,
  withinLimits,
} from '@/lib/limits.ts'
import { ARCHETYPES, archetype, roofForm, structureFor } from '@/lib/typology.ts'
import { DESIGN_SCHEMA_VERSION, parseDesign, serializeDesign } from '@/persistence'

const HAZARD: WindHazard = {
  kind: 'wind',
  gustSpeed_kmh: 150,
  directionDeg: 0,
  terrainRoughness: 0.02,
}

it('keeps every archetype inside the editing limits', () => {
  // A preset that put a control out of range would be a trap: the student
  // picks it, then cannot move the slider back.
  for (const entry of ARCHETYPES) {
    const built = structureFor(entry)
    expect(withinLimits(built.storeys.length, STOREY_COUNT_LIMITS), entry.label).toBe(true)
    for (const storey of built.storeys) {
      expect(withinLimits(storey.height_m, STOREY_HEIGHT_LIMITS_M), entry.label).toBe(true)
      expect(withinLimits(storey.widthX_m, PLAN_WIDTH_LIMITS_M), entry.label).toBe(true)
      expect(withinLimits(storey.widthY_m, PLAN_WIDTH_LIMITS_M), entry.label).toBe(true)
    }
  }
})

it('builds a structure the engine will actually analyse', () => {
  // The point of archetypes being ordinary structures: nothing in the engine
  // branches on which one was chosen, so all of them have to survive it.
  for (const entry of ARCHETYPES) {
    const result = analyze(structureFor(entry), HAZARD, MATERIAL_LIBRARY)
    expect(result.storeys.length, entry.label).toBe(entry.storeyCount)
    for (const storey of result.storeys) {
      expect(Number.isFinite(storey.utilization), entry.label).toBe(true)
    }
  }
})

it('names a material the library actually has', () => {
  for (const entry of ARCHETYPES) {
    expect(MATERIAL_LIBRARY.get(entry.materialId), entry.label).toBeDefined()
  }
})

it('round-trips every archetype through save and load', () => {
  // Adding `typology` bumped the schema; this is what proves the new field
  // survives the trip rather than being dropped by the parser.
  for (const entry of ARCHETYPES) {
    const saved = {
      schemaVersion: DESIGN_SCHEMA_VERSION,
      name: entry.label,
      savedAt: '2026-09-06T12:00:00.000Z',
      structure: structureFor(entry),
      hazard: HAZARD,
    }
    const reloaded = parseDesign(JSON.parse(serializeDesign(saved)), MATERIAL_LIBRARY)
    expect(reloaded.structure.typology, entry.label).toBe(entry.typology)
    expect(reloaded.structure).toEqual(saved.structure)
  }
})

it('gives a design that claims nothing a flat top', () => {
  // 'custom' is the honest absence — a freely edited design, or one saved
  // before typologies existed. It must not be handed somebody else's gable.
  expect(roofForm('custom')).toBe('flat')
  expect(archetype('custom')).toBeUndefined()
})

it('offers each building kind exactly once, and never offers "custom"', () => {
  const kinds = ARCHETYPES.map((entry) => entry.typology)
  expect(new Set(kinds).size).toBe(kinds.length)
  expect(kinds).not.toContain('custom')
  // Every archetype must be reachable by the name it stores, or the picker
  // cannot show which one is selected.
  for (const entry of ARCHETYPES) {
    expect(archetype(entry.typology)?.label).toBe(entry.label)
  }
})

it('spans a real range of buildings, not six variations of one', () => {
  const heights = ARCHETYPES.map((entry) => entry.storeyCount * entry.storeyHeight_m)
  expect(Math.min(...heights)).toBeLessThan(10)
  expect(Math.max(...heights)).toBeGreaterThan(50)
  expect(new Set(ARCHETYPES.map((entry) => entry.roof)).size).toBeGreaterThan(2)
})
