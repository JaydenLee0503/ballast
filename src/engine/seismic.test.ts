/**
 * The seismic branch, checked the way `analyze.test.ts` checks the wind one:
 * one fully hand-worked case first, then the properties a spot check cannot
 * see.
 *
 * HAND-WORKED CASE. Six storeys of 3.5 m (21 m tall), 18 x 12 m plan,
 * cross-laminated timber shear walls, at Ss = 1.5 g, S1 = 0.6 g, Site Class D:
 *
 *   Fa   = 1.0      Table 11.4-1, Site D, Ss >= 1.25
 *   Fv   = 1.7      Table 11.4-2, Site D, S1 = 0.6
 *   SMS  = 1.0 * 1.5 = 1.5 g          SM1 = 1.7 * 0.6 = 1.02 g
 *   SDS  = 2/3 * 1.5 = 1.0 g          SD1 = 2/3 * 1.02 = 0.68 g
 *   Ta   = 0.0488 * 21^0.75 = 0.4787 s     (Table 12.8-2, "all other")
 *   Cs   = SDS/(R/Ie) = 1.0/5 = 0.200      (Eq. 12.8-2)
 *          capped at SD1/(T*R/Ie) = 0.68/(0.4787*5) = 0.284 -> not binding
 *          floored at 0.044*SDS*Ie = 0.044 and at 0.5*S1/(R/Ie) = 0.060
 *   k    = 1                               (T <= 0.5 s)
 *   V    = 0.200 * W
 *
 * Change a coefficient and this test says which step moved.
 */

import { describe, expect, it } from 'vitest'
import {
  analyze,
  approximatePeriod_s,
  designSpectrum,
  distributeBaseShear_kN,
  governingSystem,
  MATERIAL_LIBRARY,
  seismicDesign,
  seismicResponseCoefficient,
  SEISMIC_SYSTEM_FACTORS,
  siteCoefficients,
  verticalDistributionExponent,
  type SeismicHazard,
  type Storey,
  type Structure,
} from './index.ts'

const STOREY: Storey = {
  height_m: 3.5,
  widthX_m: 18,
  widthY_m: 12,
  planShape: 'rectangle',
  materialId: 'cross-laminated-timber',
  lateralSystem: 'shear-wall',
  facade: 'punched',
}

function tower(count: number, overrides: Partial<Storey> = {}): Structure {
  return {
    typology: 'custom',
    storeys: Array.from({ length: count }, () => ({ ...STOREY, ...overrides })),
    foundation: { type: 'raft', embedmentDepth_m: 1.5, anchorCapacity_kN: 600 },
    exposureCategory: 'C',
  }
}

const HAZARD: SeismicHazard = {
  kind: 'seismic',
  Ss_g: 1.5,
  S1_g: 0.6,
  siteClass: 'D',
  directionDeg: 0,
}

describe('the hand-worked case, step by step', () => {
  const spectrum = designSpectrum(HAZARD)

  it('reads Fa and Fv off Tables 11.4-1 and 11.4-2', () => {
    const { Fa, Fv } = siteCoefficients('D', 1.5, 0.6)
    expect(Fa).toBeCloseTo(1.0, 6)
    expect(Fv).toBeCloseTo(1.7, 6)
  })

  it('takes two thirds of the site-adjusted MCE accelerations', () => {
    expect(spectrum.SMS_g).toBeCloseTo(1.5, 6)
    expect(spectrum.SM1_g).toBeCloseTo(1.02, 6)
    expect(spectrum.SDS_g).toBeCloseTo(1.0, 6)
    expect(spectrum.SD1_g).toBeCloseTo(0.68, 6)
  })

  it('estimates the period from the height alone', () => {
    expect(approximatePeriod_s(21, 'shear-wall', 'timber')).toBeCloseTo(0.4787, 3)
  })

  it('lands Cs on the short-period plateau, not on the cap or a floor', () => {
    const cs = seismicResponseCoefficient(spectrum, 0.4787, 0.6, 5)
    expect(cs).toBeCloseTo(0.2, 4)
  })

  it('distributes as an inverted triangle at this period', () => {
    expect(verticalDistributionExponent(0.4787)).toBe(1)
  })

  it('applies Cs to the weight it was given', () => {
    const design = seismicDesign(HAZARD, 21, ['shear-wall'], 'timber', [1000], [1.75])
    expect(design.baseShear_kN).toBeCloseTo(200, 6)
    expect(design.storeyForces_kN).toEqual([200])
  })
})

describe('the design spectrum', () => {
  it('amplifies on soft soil and damps on rock', () => {
    const soft = designSpectrum({ ...HAZARD, Ss_g: 0.25, siteClass: 'E' })
    const rock = designSpectrum({ ...HAZARD, Ss_g: 0.25, siteClass: 'A' })
    expect(soft.SDS_g).toBeGreaterThan(rock.SDS_g * 2.5)
  })

  it('clamps outside the tabulated range rather than extrapolating', () => {
    const past = siteCoefficients('D', 99, 99)
    const last = siteCoefficients('D', 1.5, 0.6)
    expect(past).toEqual(last)
  })
})

describe('the response coefficient', () => {
  const spectrum = designSpectrum(HAZARD)

  it('falls off as 1/T once the building is flexible enough', () => {
    const short = seismicResponseCoefficient(spectrum, 0.5, 0.6, 5)
    const long = seismicResponseCoefficient(spectrum, 2.0, 0.6, 5)
    expect(long).toBeLessThan(short)
    // On the descending branch it is exactly SD1 / (T * R/Ie).
    expect(long).toBeCloseTo(0.68 / (2.0 * 5), 6)
  })

  it('never falls below the floors, however flexible the building', () => {
    const quiet = designSpectrum({ ...HAZARD, Ss_g: 0.1, S1_g: 0.05 })
    const cs = seismicResponseCoefficient(quiet, 30, 0.05, 8)
    expect(cs).toBeGreaterThanOrEqual(0.01)
  })

  it('gives a ductile system a smaller design force', () => {
    const wall = seismicResponseCoefficient(spectrum, 0.5, 0.6, SEISMIC_SYSTEM_FACTORS['shear-wall'].R)
    const frame = seismicResponseCoefficient(spectrum, 0.5, 0.6, SEISMIC_SYSTEM_FACTORS['moment-frame'].R)
    expect(frame).toBeLessThan(wall)
  })
})

describe('the vertical distribution', () => {
  it('sums to the base shear', () => {
    const forces = distributeBaseShear_kN(1000, [100, 100, 100], [2, 6, 10], 1.4)
    expect(forces.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 6)
  })

  it('puts more force higher up, and more so at a longer period', () => {
    const weights = [100, 100, 100]
    const heights = [2, 6, 10]
    const stiff = distributeBaseShear_kN(1000, weights, heights, 1)
    const flexible = distributeBaseShear_kN(1000, weights, heights, 2)
    expect(stiff[2]).toBeGreaterThan(stiff[0] as number)
    expect(flexible[2] as number).toBeGreaterThan(stiff[2] as number)
  })

  it('falls back to weight alone when every storey sits at zero height', () => {
    const forces = distributeBaseShear_kN(300, [100, 200], [0, 0], 2)
    expect(forces).toEqual([100, 200])
  })
})

describe('a mixed stack is designed as its weakest system', () => {
  it('takes the lowest R in the building, per §12.2.3.1', () => {
    expect(governingSystem(['moment-frame', 'shear-wall', 'none'])).toBe('none')
    expect(governingSystem(['moment-frame', 'braced-frame'])).toBe('braced-frame')
  })
})

describe('through analyze()', () => {
  const run = (structure: Structure, hazard: SeismicHazard = HAZARD) =>
    analyze(structure, hazard, MATERIAL_LIBRARY)

  it('reports the hazard it was given', () => {
    expect(run(tower(6)).hazardKind).toBe('seismic')
  })

  it('checks drift against the seismic limit, not the wind one', () => {
    expect(run(tower(6)).driftLimitRatio).toBeCloseTo(0.02, 6)
  })

  it('has no velocity pressure to report', () => {
    const storey = run(tower(6)).storeys[0]
    expect(storey?.Kz).toBeUndefined()
    expect(storey?.velocityPressure_Pa).toBeUndefined()
  })

  it('scales the base shear with the seismic weight', () => {
    // A heavier envelope is more mass to accelerate, and nothing else changes.
    const light = run(tower(6, { facade: 'curtain-wall' }))
    const heavy = run(tower(6, { facade: 'punched' }))
    expect(heavy.stability.baseShear_kN).toBeGreaterThan(
      light.stability.baseShear_kN,
    )
  })

  it('is the opposite lesson from wind: mass hurts here and helps there', () => {
    const light = { ...tower(6, { facade: 'curtain-wall' }) }
    const heavy = { ...tower(6, { facade: 'punched' }) }
    const wind = {
      kind: 'wind' as const,
      gustSpeed_kmh: 150,
      directionDeg: 0,
      terrainRoughness: 0.02,
    }
    // Under wind the load does not change with weight, so the heavier building
    // is simply harder to tip over.
    expect(
      analyze(heavy, wind, MATERIAL_LIBRARY).stability.factorOfSafetyOverturning,
    ).toBeGreaterThan(
      analyze(light, wind, MATERIAL_LIBRARY).stability.factorOfSafetyOverturning,
    )
    // Under an earthquake the extra weight is also extra force, and the
    // restoring moment it buys does not keep up with the overturning moment
    // it causes.
    expect(run(heavy).stability.factorOfSafetyOverturning).toBeLessThan(
      run(light).stability.factorOfSafetyOverturning,
    )
  })

  it('grows monotonically with the mapped acceleration', () => {
    const shears = [0.2, 0.6, 1.0, 1.5].map(
      (Ss_g) => run(tower(6), { ...HAZARD, Ss_g }).stability.baseShear_kN,
    )
    for (let i = 1; i < shears.length; i += 1) {
      expect(shears[i] as number).toBeGreaterThan(shears[i - 1] as number)
    }
  })

  it('warns that the seismic weight is only the frame and the facade', () => {
    expect(run(tower(6)).warnings.join(' ')).toMatch(/§12\.7\.2/)
  })

  it('warns when one unbraced storey costs the tower its ductility credit', () => {
    const mixed = tower(6)
    const ground = mixed.storeys[0]
    if (ground) ground.lateralSystem = 'none'
    expect(run(mixed).warnings.join(' ')).toMatch(/weakest of them govern/)
  })

  it('produces a finite result at zero seismicity', () => {
    const calm = run(tower(6), { ...HAZARD, Ss_g: 0, S1_g: 0 })
    // The 0.01 absolute floor on Cs means even "no earthquake" is a small
    // lateral load, which is what ASCE 7 Eq. 12.8-5 intends.
    expect(calm.stability.baseShear_kN).toBeGreaterThan(0)
    expect(Number.isFinite(calm.scoreCard.safetyFactor)).toBe(true)
  })
})
