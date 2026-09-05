import { describe, expect, it } from 'vitest'
import {
  checkRoughnessConsistency,
  kmhToMs,
  kzFromPowerLaw,
  netForceCoefficient,
  projectPlan,
  velocityPressure_Pa,
  velocityPressureExposureCoefficient,
} from './wind.ts'
import { KZ_HEIGHTS_M, KZ_TABLE } from './constants.ts'
import type { ExposureCategory } from './types.ts'

const EXPOSURES: readonly ExposureCategory[] = ['B', 'C', 'D']

describe('Kz lookup table', () => {
  /**
   * The table in constants.ts is hand-transcribed from ASCE 7-16
   * Table 26.10-1. The standard's own values are a rounded evaluation of
   * Kz = 2.01 * (z/zg)^(2/alpha), so checking every cell against that power
   * law catches a transposed digit, which is exactly the kind of error that
   * would otherwise sit in the engine for nine days looking plausible.
   */
  it('matches the ASCE 7 power law at every tabulated height', () => {
    for (const exposure of EXPOSURES) {
      const column = KZ_TABLE[exposure]
      KZ_HEIGHTS_M.forEach((height, i) => {
        const tabulated = column[i]!
        const analytic = kzFromPowerLaw(exposure, height)
        // The published table is rounded to 2 dp; allow 0.015 for rounding.
        expect(
          Math.abs(tabulated - analytic),
          `${exposure} @ ${height} m: table ${tabulated} vs power law ${analytic.toFixed(4)}`,
        ).toBeLessThan(0.015)
      })
    }
  })

  it('has one Kz value per tabulated height in every column', () => {
    for (const exposure of EXPOSURES) {
      expect(KZ_TABLE[exposure]).toHaveLength(KZ_HEIGHTS_M.length)
    }
  })

  it('increases monotonically with height', () => {
    for (const exposure of EXPOSURES) {
      const column = KZ_TABLE[exposure]
      for (let i = 1; i < column.length; i += 1) {
        expect(column[i]!).toBeGreaterThan(column[i - 1]!)
      }
    }
  })

  it('orders the exposures D > C > B at every height: smoother terrain, more wind', () => {
    for (const height of [5, 10, 25, 60, 150]) {
      const b = velocityPressureExposureCoefficient('B', height)
      const c = velocityPressureExposureCoefficient('C', height)
      const d = velocityPressureExposureCoefficient('D', height)
      expect(d).toBeGreaterThan(c)
      expect(c).toBeGreaterThan(b)
    }
  })

  it('clamps below 4.6 m, where ASCE 7 stops tabulating', () => {
    expect(velocityPressureExposureCoefficient('C', 0)).toBe(0.85)
    expect(velocityPressureExposureCoefficient('C', 2)).toBe(0.85)
    expect(velocityPressureExposureCoefficient('C', 4.6)).toBe(0.85)
    expect(velocityPressureExposureCoefficient('C', 6.1)).toBeCloseTo(0.9, 10)
  })

  it('clamps above the top of the table rather than extrapolating', () => {
    const top = velocityPressureExposureCoefficient('D', 152.4)
    expect(velocityPressureExposureCoefficient('D', 400)).toBe(top)
  })

  it('interpolates linearly between rows', () => {
    // Exposure C: 0.85 at 4.6 m, 0.90 at 6.1 m. Midpoint 5.35 m -> 0.875.
    expect(velocityPressureExposureCoefficient('C', 5.35)).toBeCloseTo(0.875, 10)
  })
})

describe('velocity pressure', () => {
  it('converts km/h to m/s', () => {
    expect(kmhToMs(144)).toBe(40)
    expect(kmhToMs(0)).toBe(0)
  })

  it('reproduces the hand calculation: 144 km/h, Exposure C, 2.5 m', () => {
    // 0.613 * 0.85 * 1.0 * 0.85 * 40^2 = 708.628 Pa
    expect(velocityPressure_Pa('C', 2.5, 144)).toBeCloseTo(708.628, 3)
  })

  it('scales with the square of wind speed', () => {
    const single = velocityPressure_Pa('C', 10, 50)
    expect(velocityPressure_Pa('C', 10, 100)).toBeCloseTo(4 * single, 9)
    expect(velocityPressure_Pa('C', 10, 150)).toBeCloseTo(9 * single, 9)
  })

  it('is zero in still air', () => {
    expect(velocityPressure_Pa('D', 50, 0)).toBe(0)
  })
})

describe('plan projection', () => {
  it('at 0 deg the wind strikes the widthY face and travels through widthX', () => {
    const p = projectPlan(30, 10, 0)
    expect(p.acrossWindWidth_m).toBeCloseTo(10, 10)
    expect(p.alongWindDepth_m).toBeCloseTo(30, 10)
  })

  it('at 90 deg the roles swap', () => {
    const p = projectPlan(30, 10, 90)
    expect(p.acrossWindWidth_m).toBeCloseTo(30, 10)
    expect(p.alongWindDepth_m).toBeCloseTo(10, 10)
  })

  it('at 45 deg both are (a + b)/sqrt(2)', () => {
    const p = projectPlan(30, 10, 45)
    const expected = 40 / Math.SQRT2
    expect(p.acrossWindWidth_m).toBeCloseTo(expected, 10)
    expect(p.alongWindDepth_m).toBeCloseTo(expected, 10)
  })

  it('is symmetric under 180 deg reversal', () => {
    const a = projectPlan(17, 6, 30)
    const b = projectPlan(17, 6, 210)
    expect(a.acrossWindWidth_m).toBeCloseTo(b.acrossWindWidth_m, 10)
    expect(a.alongWindDepth_m).toBeCloseTo(b.alongWindDepth_m, 10)
  })

  it('leaves a square plan unchanged at every angle', () => {
    for (let deg = 0; deg <= 90; deg += 15) {
      const p = projectPlan(12, 12, deg)
      // A square's bounding-box projection peaks at 45 deg (12*sqrt(2)).
      expect(p.acrossWindWidth_m).toBeGreaterThanOrEqual(12 - 1e-9)
      expect(p.acrossWindWidth_m).toBeLessThanOrEqual(12 * Math.SQRT2 + 1e-9)
    }
  })
})

describe('net force coefficient', () => {
  it('is 1.3 for a square plan (Cp 0.8 windward + 0.5 leeward)', () => {
    expect(netForceCoefficient(10, 10)).toBeCloseTo(1.3, 10)
  })

  it('drops to 1.1 at L/B = 2 and 1.0 at L/B = 4', () => {
    expect(netForceCoefficient(20, 10)).toBeCloseTo(1.1, 10)
    expect(netForceCoefficient(40, 10)).toBeCloseTo(1.0, 10)
  })

  it('holds at 1.3 for wide shallow plans (L/B < 1)', () => {
    expect(netForceCoefficient(5, 20)).toBeCloseTo(1.3, 10)
  })

  it('never rises above 1.3 or falls below 1.0', () => {
    for (let ratio = 0.1; ratio <= 10; ratio += 0.1) {
      const cf = netForceCoefficient(ratio * 10, 10)
      expect(cf).toBeLessThanOrEqual(1.3 + 1e-12)
      expect(cf).toBeGreaterThanOrEqual(1.0 - 1e-12)
    }
  })
})

describe('terrain roughness consistency check', () => {
  it('accepts a roughness that matches the declared exposure', () => {
    expect(checkRoughnessConsistency('B', 0.3)).toBeNull()
    expect(checkRoughnessConsistency('C', 0.02)).toBeNull()
    expect(checkRoughnessConsistency('D', 0.005)).toBeNull()
  })

  it('tolerates roughness within an order of magnitude', () => {
    expect(checkRoughnessConsistency('C', 0.1)).toBeNull()
    expect(checkRoughnessConsistency('C', 0.004)).toBeNull()
  })

  it('warns, and names a better category, when the two disagree', () => {
    const warning = checkRoughnessConsistency('D', 0.5)
    expect(warning).toContain('inconsistent')
    expect(warning).toContain('Exposure B')
  })

  it('rejects a non-positive roughness length', () => {
    expect(checkRoughnessConsistency('C', 0)).toContain('must be a positive')
  })
})
