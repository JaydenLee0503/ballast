import { describe, expect, it } from 'vitest'
import { analyze, StructureValidationError } from './analyze.ts'
import { MATERIAL_LIBRARY } from './materials.ts'
import { MaterialDataError } from './materials.ts'
import { grossFloorArea_m2 } from './sustainability.ts'
import type { Storey, Structure, WindHazard } from './types.ts'

const storey = (overrides: Partial<Storey> = {}): Storey => ({
  height_m: 3.5,
  widthX_m: 12,
  widthY_m: 12,
  materialId: 'reinforced-concrete',
  lateralSystem: 'shear-wall',
  ...overrides,
})

const structure = (overrides: Partial<Structure> = {}): Structure => ({
  storeys: [storey()],
  foundation: { type: 'raft', embedmentDepth_m: 1, anchorCapacity_kN: 100 },
  exposureCategory: 'C',
  ...overrides,
})

const wind = (overrides: Partial<WindHazard> = {}): WindHazard => ({
  kind: 'wind',
  gustSpeed_kmh: 150,
  directionDeg: 0,
  terrainRoughness: 0.02,
  ...overrides,
})

describe('input validation', () => {
  it('rejects a structure with no storeys', () => {
    expect(() =>
      analyze(structure({ storeys: [] }), wind(), MATERIAL_LIBRARY),
    ).toThrow(StructureValidationError)
  })

  it('rejects non-positive storey dimensions, naming the storey and the field', () => {
    for (const field of ['height_m', 'widthX_m', 'widthY_m'] as const) {
      expect(() =>
        analyze(
          structure({ storeys: [storey(), storey({ [field]: 0 })] }),
          wind(),
          MATERIAL_LIBRARY,
        ),
      ).toThrow(new RegExp(`storey 1: ${field} must be a positive`))
    }
  })

  it('rejects NaN and Infinity dimensions', () => {
    expect(() =>
      analyze(structure({ storeys: [storey({ height_m: NaN })] }), wind(), MATERIAL_LIBRARY),
    ).toThrow(StructureValidationError)
    expect(() =>
      analyze(
        structure({ storeys: [storey({ widthX_m: Infinity })] }),
        wind(),
        MATERIAL_LIBRARY,
      ),
    ).toThrow(StructureValidationError)
  })

  it('rejects negative foundation values', () => {
    expect(() =>
      analyze(
        structure({
          foundation: { type: 'raft', embedmentDepth_m: -1, anchorCapacity_kN: 0 },
        }),
        wind(),
        MATERIAL_LIBRARY,
      ),
    ).toThrow(/embedmentDepth_m must be >= 0/)
    expect(() =>
      analyze(
        structure({
          foundation: { type: 'raft', embedmentDepth_m: 0, anchorCapacity_kN: -5 },
        }),
        wind(),
        MATERIAL_LIBRARY,
      ),
    ).toThrow(/anchorCapacity_kN must be >= 0/)
  })

  it('rejects a negative gust speed', () => {
    expect(() =>
      analyze(structure(), wind({ gustSpeed_kmh: -10 }), MATERIAL_LIBRARY),
    ).toThrow(/gustSpeed_kmh must be >= 0/)
  })

  it('rejects a storey referencing a material that is not in the library', () => {
    expect(() =>
      analyze(
        structure({ storeys: [storey({ materialId: 'adamantium' })] }),
        wind(),
        MATERIAL_LIBRARY,
      ),
    ).toThrow(MaterialDataError)
  })
})

describe('warnings', () => {
  const warningsFor = (s: Structure, h: WindHazard) =>
    analyze(s, h, MATERIAL_LIBRARY).warnings.join('\n')

  it('warns when the roughness contradicts the exposure category', () => {
    const text = warningsFor(structure({ exposureCategory: 'D' }), wind({ terrainRoughness: 0.5 }))
    expect(text).toContain('inconsistent with exposure D')
  })

  it('warns past the rigid-building storey limit', () => {
    const tall = structure({
      storeys: Array.from({ length: 20 }, () => storey()),
    })
    expect(warningsFor(tall, wind())).toContain('rigid-building')
  })

  it('warns when the building runs off the top of the Kz table', () => {
    const veryTall = structure({
      storeys: Array.from({ length: 50 }, () => storey({ height_m: 4 })),
    })
    expect(warningsFor(veryTall, wind())).toContain('above the top of the')
  })

  it('warns about a lateral system the material cannot form', () => {
    const absurd = structure({
      storeys: [
        storey({ materialId: 'rammed-earth', lateralSystem: 'moment-frame' }),
      ],
    })
    const text = warningsFor(absurd, wind())
    expect(text).toContain('not a buildable system')
    expect(text).toContain('nobody can construct')
  })

  it('still returns numbers for an unbuildable design rather than refusing', () => {
    // Students learn by trying the absurd thing and reading why it is absurd.
    const absurd = structure({
      storeys: [
        storey({ materialId: 'rammed-earth', lateralSystem: 'moment-frame' }),
      ],
    })
    const result = analyze(absurd, wind(), MATERIAL_LIBRARY)
    expect(result.scoreCard.carbonKg).toBeGreaterThan(0)
    expect(Number.isFinite(result.scoreCard.safetyFactor)).toBe(true)
  })

  it('always flags indicative costs', () => {
    expect(warningsFor(structure(), wind())).toContain('indicative per-m^3 rates')
  })
})

describe('degenerate but legal inputs', () => {
  it('reports infinite safety factors in still air rather than NaN', () => {
    const result = analyze(structure(), wind({ gustSpeed_kmh: 0 }), MATERIAL_LIBRARY)
    expect(result.stability.baseShear_kN).toBe(0)
    expect(result.scoreCard.safetyFactor).toBe(Number.POSITIVE_INFINITY)
    expect(result.scoreCard.driftRatio).toBe(0)
    expect(result.scoreCard.governingFailureMode).toBe('none')
  })

  it('handles a zero-embedment foundation with no anchors', () => {
    const result = analyze(
      structure({
        foundation: { type: 'slab-on-grade', embedmentDepth_m: 0, anchorCapacity_kN: 0 },
      }),
      wind(),
      MATERIAL_LIBRARY,
    )
    expect(result.stability.slidingResistancePassive_kN).toBe(0)
    expect(result.stability.restoringMomentAnchorage_kNm).toBe(0)
    expect(result.stability.factorOfSafetySliding).toBeGreaterThan(0)
  })

  it('gives a storey with no lateral system a huge drift, not a crash', () => {
    const result = analyze(
      structure({ storeys: [storey({ lateralSystem: 'none' })] }),
      wind(),
      MATERIAL_LIBRARY,
    )
    const first = result.storeys[0]!
    expect(first.driftRatio).toBeGreaterThan(1 / 500)
    expect(Number.isFinite(first.driftRatio)).toBe(true)
    expect(result.scoreCard.governingFailureMode).toBe('drift')
  })

  it('accumulates shear correctly: the top storey carries only its own force', () => {
    const result = analyze(
      structure({ storeys: Array.from({ length: 4 }, () => storey()) }),
      wind(),
      MATERIAL_LIBRARY,
    )
    const top = result.storeys[3]!
    expect(top.storeyShear_kN).toBeCloseTo(top.lateralForce_kN, 10)
    // ...and the ground storey carries the sum of all of them.
    const total = result.storeys.reduce((s, r) => s + r.lateralForce_kN, 0)
    expect(result.storeys[0]!.storeyShear_kN).toBeCloseTo(total, 10)
    expect(result.stability.baseShear_kN).toBeCloseTo(total, 10)
  })

  it('makes carbon and cost additive across storeys', () => {
    const result = analyze(
      structure({ storeys: Array.from({ length: 5 }, () => storey()) }),
      wind(),
      MATERIAL_LIBRARY,
    )
    const carbon = result.storeys.reduce((s, r) => s + r.embodiedCarbon_kgCO2e, 0)
    expect(result.scoreCard.carbonKg).toBeCloseTo(carbon, 6)
  })
})

describe('gross floor area', () => {
  it('sums the plan rectangle of every storey', () => {
    // 5 storeys x 12 m x 12 m = 5 x 144 = 720 m2.
    const area = grossFloorArea_m2(
      structure({ storeys: Array.from({ length: 5 }, () => storey()) }),
    )
    expect(area).toBeCloseTo(720, 10)
  })

  it('respects per-storey plan dimensions, so setbacks reduce it', () => {
    // 12x12 = 144 at the base, 8x6 = 48 above. Total 192 m2.
    const area = grossFloorArea_m2(
      structure({
        storeys: [storey(), storey({ widthX_m: 8, widthY_m: 6 })],
      }),
    )
    expect(area).toBeCloseTo(192, 10)
  })

  it('is the denominator for carbon intensity, so it must never be zero for a real structure', () => {
    expect(grossFloorArea_m2(structure())).toBeGreaterThan(0)
  })
})
