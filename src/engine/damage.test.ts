/**
 * The damage banding.
 *
 * The property worth holding is that it adds no physics: every state here is a
 * band of a `utilization` the engine already produced, and the verdict follows
 * the global checks rather than a headcount of red storeys. So the tests are
 * mostly about what it must NOT do — invent a collapse, or draw a building
 * standing when its overturning factor says otherwise.
 */

import { describe, expect, it } from 'vitest'
import {
  analyze,
  assessDamage,
  damageState,
  DAMAGE_THRESHOLDS,
  MATERIAL_LIBRARY,
  type ScoreCard,
  type Storey,
  type StoreyResult,
  type Structure,
} from './index.ts'

const SCORE: ScoreCard = {
  safetyFactor: 3,
  carbonKg: 1000,
  costUsd: 1000,
  driftRatio: 0.001,
  governingFailureMode: 'none',
}

function storey(utilization: number): StoreyResult {
  return {
    index: 0,
    baseElevation_m: 0,
    midHeight_m: 1.75,
    height_m: 3.5,
    projectedArea_m2: 40,
    loadElevation_m: 1.75,
    lateralForce_kN: 10,
    storeyShear_kN: 10,
    materialVolume_m3: 10,
    selfWeight_kN: 100,
    embodiedCarbon_kgCO2e: 100,
    cost_usd: 100,
    facadeArea_m2: 10,
    facadeCarbon_kgCO2e: 1,
    facadeCost_usd: 1,
    facadeWeight_kN: 1,
    stiffness_kN_per_m: 1000,
    drift_m: 0.001,
    driftRatio: 0.001,
    exceedsDriftLimit: false,
    driftUtilization: utilization,
    strengthUtilization: 0,
    utilization,
    damage: 'intact',
  }
}

describe('the bands', () => {
  it('lines up with the thresholds it documents', () => {
    expect(damageState(0.99)).toBe('intact')
    expect(damageState(DAMAGE_THRESHOLDS.cracked)).toBe('cracked')
    expect(damageState(DAMAGE_THRESHOLDS.severe)).toBe('severe')
    expect(damageState(DAMAGE_THRESHOLDS.collapsed)).toBe('collapsed')
  })

  it('treats a non-finite utilisation as collapse, not as safe', () => {
    expect(damageState(Number.POSITIVE_INFINITY)).toBe('collapsed')
    expect(damageState(Number.NaN)).toBe('collapsed')
  })
})

describe('the verdict', () => {
  it('says a comfortable building stands', () => {
    expect(assessDamage([storey(0.4)], SCORE, 'wind').verdict).toBe('stands')
  })

  it('fails a building whose global checks fail, however green its storeys', () => {
    const report = assessDamage(
      [storey(0.2)],
      { ...SCORE, safetyFactor: 0.8, governingFailureMode: 'overturning' },
      'wind',
    )
    expect(report.verdict).toBe('failed')
    expect(report.headline).toMatch(/tipped/)
  })

  it('names the flood failure a flood actually has', () => {
    const report = assessDamage(
      [storey(0.2)],
      { ...SCORE, safetyFactor: 0.5, governingFailureMode: 'flotation' },
      'flood',
    )
    expect(report.headline).toMatch(/floated/)
  })

  it('reports the lowest collapsed storey, because it takes the rest with it', () => {
    const report = assessDamage(
      [storey(0.3), storey(3), storey(4)],
      SCORE,
      'seismic',
    )
    expect(report.collapseIndex).toBe(1)
    expect(report.verdict).toBe('failed')
  })

  it('has no collapse index when nothing collapsed', () => {
    expect(assessDamage([storey(1.2)], SCORE, 'wind').collapseIndex).toBeNull()
  })
})

describe('through analyze()', () => {
  const storeyOf = (overrides: Partial<Storey> = {}): Storey => ({
    height_m: 3.5,
    widthX_m: 18,
    widthY_m: 12,
    planShape: 'rectangle',
    materialId: 'cross-laminated-timber',
    lateralSystem: 'shear-wall',
    facade: 'punched',
    ...overrides,
  })
  const structure: Structure = {
    typology: 'custom',
    storeys: Array.from({ length: 6 }, () => storeyOf()),
    foundation: { type: 'raft', embedmentDepth_m: 1.5, anchorCapacity_kN: 600 },
    exposureCategory: 'C',
  }

  it('puts the same band on the storey and in the report', () => {
    const result = analyze(
      structure,
      { kind: 'wind', gustSpeed_kmh: 250, directionDeg: 0, terrainRoughness: 0.02 },
      MATERIAL_LIBRARY,
    )
    result.storeys.forEach((s, i) => {
      expect(s.damage).toBe(result.damage.storeys[i])
      expect(s.damage).toBe(damageState(s.utilization))
    })
  })

  it('leaves a calm design intact', () => {
    const result = analyze(
      structure,
      { kind: 'wind', gustSpeed_kmh: 0, directionDeg: 0, terrainRoughness: 0.02 },
      MATERIAL_LIBRARY,
    )
    expect(result.damage.verdict).toBe('stands')
    expect(result.damage.storeys.every((s) => s === 'intact')).toBe(true)
  })
})
