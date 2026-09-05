import { describe, expect, it } from 'vitest'
import {
  buildMaterialLibrary,
  getMaterial,
  MATERIAL_LIBRARY,
  MaterialDataError,
} from './materials.ts'
import { BUILDABLE_SYSTEMS, STRUCTURAL_FRACTION } from './constants.ts'

describe('seed material library', () => {
  it('loads all eight seed materials', () => {
    expect(MATERIAL_LIBRARY.size).toBe(8)
    for (const id of [
      'reinforced-concrete',
      'structural-steel',
      'cross-laminated-timber',
      'glulam',
      'bamboo-composite',
      'rammed-earth',
      'clay-brick-masonry',
      'aluminium',
    ]) {
      expect(MATERIAL_LIBRARY.has(id), `missing ${id}`).toBe(true)
    }
  })

  it('cites a source for every numeric property of every material', () => {
    for (const material of MATERIAL_LIBRARY.values()) {
      for (const field of [
        'density',
        'youngsModulus',
        'yieldStrength',
        'embodiedCarbon',
        'cost',
      ] as const) {
        const citation = material.sources[field]
        expect(
          citation?.length ?? 0,
          `${material.id}.sources.${field} is empty`,
        ).toBeGreaterThan(20)
      }
    }
  })

  /**
   * Published embodied carbon factors are per kilogram. Each entry's
   * kgCO2e/m^3 should therefore equal density x factor. Recomputing that here
   * catches a transcription slip between the cited factor and the stored
   * volumetric value.
   */
  it('has volumetric carbon consistent with the cited per-kg factor', () => {
    const citedFactors_kgCO2e_per_kg: Record<string, number> = {
      'cross-laminated-timber': 0.437,
      glulam: 0.512,
      'clay-brick-masonry': 0.213,
      'structural-steel': 1.55,
      aluminium: 6.83,
    }
    for (const [id, factor] of Object.entries(citedFactors_kgCO2e_per_kg)) {
      const m = getMaterial(MATERIAL_LIBRARY, id)
      const implied = m.density_kg_m3 * factor
      // Stored values are rounded to whole kgCO2e/m^3.
      expect(Math.abs(m.embodiedCarbon_kgCO2e_m3 - implied), id).toBeLessThan(1)
    }
  })

  it('ranks carbon intensity the way the literature does', () => {
    const carbon = (id: string) =>
      getMaterial(MATERIAL_LIBRARY, id).embodiedCarbon_kgCO2e_m3
    // Per cubic metre of solid material: metals dominate, earth is lowest.
    expect(carbon('aluminium')).toBeGreaterThan(carbon('structural-steel'))
    expect(carbon('structural-steel')).toBeGreaterThan(carbon('reinforced-concrete'))
    expect(carbon('reinforced-concrete')).toBeGreaterThan(carbon('clay-brick-masonry'))
    expect(carbon('clay-brick-masonry')).toBeGreaterThan(carbon('bamboo-composite'))
    expect(carbon('bamboo-composite')).toBeGreaterThan(carbon('glulam'))
    expect(carbon('glulam')).toBeGreaterThan(carbon('rammed-earth'))
  })

  it('has a structural fraction and a buildability set for every class used', () => {
    for (const material of MATERIAL_LIBRARY.values()) {
      expect(STRUCTURAL_FRACTION[material.structuralClass]).toBeDefined()
      expect(BUILDABLE_SYSTEMS[material.structuralClass]).toBeDefined()
    }
  })

  it('flags every cost as indicative, because none of them are surveyed', () => {
    for (const material of MATERIAL_LIBRARY.values()) {
      expect(material.costConfidence).toBe('indicative')
      expect(material.sources.cost).toMatch(/INDICATIVE/)
    }
  })
})

describe('library validation', () => {
  const valid = {
    id: 'test-material',
    name: 'Test',
    structuralClass: 'steel',
    density_kg_m3: 1000,
    youngsModulus_GPa: 10,
    yieldStrength_MPa: 100,
    embodiedCarbon_kgCO2e_m3: 100,
    cost_usd_m3: 100,
    costConfidence: 'published',
    sources: {
      density: 'x',
      youngsModulus: 'x',
      yieldStrength: 'x',
      embodiedCarbon: 'x',
      cost: 'x',
    },
  }

  it('accepts a well-formed entry', () => {
    expect(buildMaterialLibrary([valid]).size).toBe(1)
  })

  /**
   * The brief's rule is to mark an unknown value TODO rather than guess. A
   * TODO reaches the engine as null, and it must stop the analysis — a
   * missing carbon figure must never quietly score as zero carbon, which
   * would make the least-documented material look like the greenest one.
   */
  it('refuses an unresolved TODO rather than scoring it as zero', () => {
    expect(() =>
      buildMaterialLibrary([{ ...valid, embodiedCarbon_kgCO2e_m3: null }]),
    ).toThrow(MaterialDataError)
    expect(() =>
      buildMaterialLibrary([{ ...valid, embodiedCarbon_kgCO2e_m3: null }]),
    ).toThrow(/unresolved TODO/)
  })

  it('rejects non-positive and non-finite properties', () => {
    for (const bad of [0, -5, NaN, Infinity, 'heavy']) {
      expect(() =>
        buildMaterialLibrary([{ ...valid, density_kg_m3: bad }]),
      ).toThrow(MaterialDataError)
    }
  })

  it('rejects duplicate ids', () => {
    expect(() => buildMaterialLibrary([valid, valid])).toThrow(/duplicate/)
  })

  it('rejects entries that are not objects, or have no id', () => {
    expect(() => buildMaterialLibrary([null])).toThrow(MaterialDataError)
    expect(() => buildMaterialLibrary([{ ...valid, id: '' }])).toThrow(/no id/)
  })

  it('throws a clear error for an unknown materialId', () => {
    expect(() => getMaterial(MATERIAL_LIBRARY, 'unobtainium')).toThrow(
      /unknown materialId "unobtainium"/,
    )
  })
})
