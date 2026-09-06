import { describe, expect, it } from 'vitest'
import { analyze } from './analyze.ts'
import { MATERIAL_LIBRARY } from './materials.ts'
import type { Structure, WindHazard } from './types.ts'

/**
 * ===========================================================================
 * THE HAND-CALCULATED CASE
 * ===========================================================================
 * One storey. Square plan. Wind blowing straight down the X axis. Every
 * number below is worked through in full so it can be checked with a
 * calculator and nothing else.
 *
 * INPUT
 *   storey     h = 5 m, widthX = 10 m, widthY = 10 m
 *   material   reinforced-concrete (rho = 2400 kg/m^3, E = 25.7 GPa,
 *              f'c = 30 MPa, 512 kgCO2e/m^3, 700 USD/m^3)
 *   system     shear-wall     -> structural fraction 0.08
 *   exposure   C              -> Kz row for open terrain
 *   wind       144 km/h gust, direction 0 deg, z0 = 0.02 m
 *   foundation embedment 0 m, anchor capacity 0 kN
 *              (both zeroed so no passive or anchorage terms muddy the check)
 *
 * ---------------------------------------------------------------------------
 * 1. WIND SPEED
 *      V = 144 km/h / 3.6 = 40 m/s exactly
 *
 * 2. HEIGHT AND Kz
 *      storey mid-height = 5 / 2 = 2.5 m
 *      ASCE 7-16 Table 26.10-1 does not go below 15 ft = 4.6 m, so z is
 *      floored at 4.6 m. The Exposure C value at 4.6 m is the first row of
 *      the table, read directly with no interpolation:
 *        Kz = 0.85
 *
 * 3. VELOCITY PRESSURE   qz = 0.613 * Kz * Kzt * Kd * V^2
 *      0.613 * 0.85          = 0.52105
 *      0.52105 * 1.0  (Kzt)  = 0.52105
 *      0.52105 * 0.85 (Kd)   = 0.4428925
 *      0.4428925 * 40^2      = 0.4428925 * 1600
 *        qz = 708.628 Pa
 *
 * 4. FORCE COEFFICIENT
 *      Wind at 0 deg blows along +X, so it strikes the face of width
 *      widthY = 10 m and travels through a depth widthX = 10 m.
 *        across-wind width B = 10 m
 *        along-wind depth  L = 10 m
 *        L/B = 1.0  ->  leeward Cp = 0.5 (ASCE 7-16 Fig. 27.3-1)
 *        Cf = Cp_windward + |Cp_leeward| = 0.8 + 0.5 = 1.3
 *
 * 5. LATERAL FORCE   F = qz * G * Cf * A
 *      A = B * h = 10 * 5 = 50 m^2
 *      708.628 * 0.85 (G) = 602.3338
 *      602.3338 * 1.3     = 783.03394
 *      783.03394 * 50     = 39,151.697 N
 *        F = 39.151697 kN     and with one storey, base shear = F
 *
 * 6. OVERTURNING MOMENT about the leeward base edge
 *      M_ot = F * z_mid = 39.151697 * 2.5
 *        M_ot = 97.879243 kNm
 *
 * 7. SELF-WEIGHT
 *      gross volume       = 5 * 10 * 10           = 500 m^3
 *      structural volume  = 500 * 0.08            = 40 m^3
 *      mass               = 40 * 2400             = 96,000 kg
 *      weight             = 96,000 * 9.80665/1000 = 941.4384 kN
 *
 * 8. RESTORING MOMENT
 *      Weight acts at the plan centroid, L/2 = 5 m from the leeward edge:
 *        M_r = 941.4384 * 5 = 4707.192 kNm
 *      Anchorage contributes 0 (anchorCapacity = 0).
 *
 * 9. FACTOR OF SAFETY, OVERTURNING
 *      FoS = 4707.192 / 97.879243 = 48.0918312
 *
 * 10. SLIDING
 *      friction = mu * W = 0.4 * 941.4384 = 376.57536 kN
 *      passive  = 0 (embedment depth is 0)
 *      FoS = 376.57536 / 39.151697 = 9.6183661
 *
 * 11. DRIFT
 *      k = C_sys * E * A_plan / h
 *        = 7.5e-5 * 25.7e9 * 100 / 5
 *        = 7.5e-5 * 2.57e12 / 5
 *        = 1.9275e8 / 5 = 3.855e7 N/m = 38,550 kN/m
 *      drift = V_storey / k = 39.151697 / 38,550 = 1.015608e-3 m
 *      ratio = 1.015608e-3 / 5 = 2.031216e-4  =  h/4923
 *      Limit is h/500 = 2.0e-3, so drift utilisation = 0.1016. Passes.
 *
 * 12. CARBON AND COST
 *      carbon = 40 m^3 * 512 kgCO2e/m^3 = 20,480 kgCO2e
 *      cost   = 40 m^3 * 700 USD/m^3    = 28,000 USD
 *
 * 13. GOVERNING MODE
 *      overturning 1.5/48.0918 = 0.0312
 *      sliding     1.5/9.61837 = 0.1559
 *      drift                   = 0.1016
 *      strength    (see below) = 0.00024
 *      Nothing exceeds 1.0, so the structure passes: 'none'.
 * ===========================================================================
 */
describe('hand-calculated single-storey case', () => {
  const structure: Structure = {
    storeys: [
      {
        height_m: 5,
        widthX_m: 10,
        widthY_m: 10,
        materialId: 'reinforced-concrete',
        lateralSystem: 'shear-wall',
        // No envelope: the thirteen steps in the header are a frame-only
        // take-off, and they must stay arithmetically reachable by hand.
        facade: 'exposed',
      },
    ],
    foundation: {
      type: 'raft',
      embedmentDepth_m: 0,
      anchorCapacity_kN: 0,
    },
    typology: 'custom',
    exposureCategory: 'C',
  }

  const hazard: WindHazard = {
    kind: 'wind',
    gustSpeed_kmh: 144,
    directionDeg: 0,
    terrainRoughness: 0.02,
  }

  const result = analyze(structure, hazard, MATERIAL_LIBRARY)
  const storey = result.storeys[0]!

  it('step 2: floors Kz at the 4.6 m table minimum', () => {
    expect(storey.Kz).toBeCloseTo(0.85, 10)
  })

  it('step 3: velocity pressure qz = 708.628 Pa', () => {
    expect(storey.velocityPressure_Pa).toBeCloseTo(708.628, 3)
  })

  it('step 5: lateral force F = 39.151697 kN', () => {
    expect(storey.projectedArea_m2).toBeCloseTo(50, 10)
    expect(storey.lateralForce_kN).toBeCloseTo(39.151697, 6)
    expect(result.stability.baseShear_kN).toBeCloseTo(39.151697, 6)
  })

  it('step 6: overturning moment = 97.879243 kNm', () => {
    expect(result.stability.overturningMoment_kNm).toBeCloseTo(97.879243, 6)
  })

  it('step 7: self-weight = 941.4384 kN from 40 m^3 of concrete', () => {
    expect(storey.materialVolume_m3).toBeCloseTo(40, 10)
    expect(result.stability.totalSelfWeight_kN).toBeCloseTo(941.4384, 4)
  })

  it('step 8: restoring moment = 4707.192 kNm, none of it from anchors', () => {
    expect(result.stability.restoringMomentSelfWeight_kNm).toBeCloseTo(4707.192, 3)
    expect(result.stability.restoringMomentAnchorage_kNm).toBe(0)
  })

  it('step 9: overturning FoS = 48.0918312', () => {
    expect(result.stability.factorOfSafetyOverturning).toBeCloseTo(48.0918312, 6)
  })

  it('step 10: sliding FoS = 9.6183, with no passive resistance', () => {
    expect(result.stability.slidingResistanceFriction_kN).toBeCloseTo(376.57536, 5)
    expect(result.stability.slidingResistancePassive_kN).toBe(0)
    expect(result.stability.factorOfSafetySliding).toBeCloseTo(9.6183661, 6)
  })

  it('step 11: stiffness 38,550 kN/m and drift ratio 1/4923', () => {
    expect(storey.stiffness_kN_per_m).toBeCloseTo(38550, 6)
    expect(storey.drift_m).toBeCloseTo(1.015608e-3, 9)
    expect(storey.driftRatio).toBeCloseTo(2.031216e-4, 10)
    expect(storey.exceedsDriftLimit).toBe(false)
    expect(1 / storey.driftRatio).toBeCloseTo(4923.15, 1)
  })

  it('step 12: 20,480 kgCO2e and 28,000 USD', () => {
    expect(result.scoreCard.carbonKg).toBeCloseTo(20480, 6)
    expect(result.scoreCard.costUsd).toBeCloseTo(28000, 6)
  })

  it('step 13: passes every check, safety factor is the sliding one', () => {
    expect(result.scoreCard.governingFailureMode).toBe('none')
    expect(result.scoreCard.safetyFactor).toBeCloseTo(9.6183661, 6)
  })

  it('produces no warnings for a well-posed model', () => {
    // Cost is 'indicative' for every seed material, so that caveat always fires.
    expect(result.warnings).toEqual([
      'Cost uses indicative per-m^3 rates, not a quantity-surveyed estimate. ' +
        'Treat cost comparisons as order-of-magnitude only.',
    ])
  })

  it('is deterministic: the same inputs give byte-identical output', () => {
    const again = analyze(structure, hazard, MATERIAL_LIBRARY)
    expect(JSON.stringify(again)).toBe(JSON.stringify(result))
  })
})

/**
 * MONOTONICITY. Wind force goes as V^2 and every downstream quantity is a
 * positive multiple of it, so base shear must be non-decreasing in gust speed.
 * A regression that breaks this — a sign slip in Kz interpolation, a clamp in
 * the wrong direction — would be invisible in a single spot-check.
 */
describe('monotonicity in gust speed', () => {
  const structure: Structure = {
    storeys: Array.from({ length: 6 }, () => ({
      height_m: 3.4,
      widthX_m: 14,
      widthY_m: 9,
      materialId: 'structural-steel',
      lateralSystem: 'braced-frame' as const,
      facade: 'exposed' as const,
    })),
    foundation: { type: 'piled', embedmentDepth_m: 2, anchorCapacity_kN: 400 },
    typology: 'custom',
    exposureCategory: 'B',
  }

  const baseShearAt = (gustSpeed_kmh: number): number =>
    analyze(
      structure,
      { kind: 'wind', gustSpeed_kmh, directionDeg: 35, terrainRoughness: 0.3 },
      MATERIAL_LIBRARY,
    ).stability.baseShear_kN

  it('never decreases as gust speed rises, across 0-400 km/h in 2 km/h steps', () => {
    let previous = -Infinity
    for (let v = 0; v <= 400; v += 2) {
      const shear = baseShearAt(v)
      expect(shear).toBeGreaterThanOrEqual(previous)
      previous = shear
    }
  })

  it('scales as V^2: doubling the gust speed quadruples base shear', () => {
    // Kz depends only on height, so the V^2 term is the only thing that moves.
    expect(baseShearAt(160)).toBeCloseTo(4 * baseShearAt(80), 9)
  })

  it('is zero at zero wind', () => {
    expect(baseShearAt(0)).toBe(0)
  })

  it('overturning demand also rises monotonically', () => {
    let previous = -Infinity
    for (let v = 0; v <= 300; v += 5) {
      const m = analyze(
        structure,
        { kind: 'wind', gustSpeed_kmh: v, directionDeg: 0, terrainRoughness: 0.3 },
        MATERIAL_LIBRARY,
      ).stability.overturningMoment_kNm
      expect(m).toBeGreaterThanOrEqual(previous)
      previous = m
    }
  })
})

/**
 * SLENDERNESS. Overturning resistance scales with W * L/2 while the
 * overturning demand scales with the wind force times the height at which it
 * acts. A tall, light, narrow tower therefore loses this contest badly to a
 * squat, heavy, wide block — the single most important structural intuition
 * this simulator has to teach.
 */
describe('tall and light vs squat and heavy', () => {
  const hazard: WindHazard = {
    kind: 'wind',
    gustSpeed_kmh: 180,
    directionDeg: 0,
    terrainRoughness: 0.02,
  }
  const foundation = {
    type: 'strip-footing' as const,
    embedmentDepth_m: 0,
    anchorCapacity_kN: 0,
  }

  // 12 storeys of CLT on a 6 x 6 m footprint: 42 m tall, 7:1 aspect ratio.
  const tallLight: Structure = {
    storeys: Array.from({ length: 12 }, () => ({
      height_m: 3.5,
      widthX_m: 6,
      widthY_m: 6,
      materialId: 'cross-laminated-timber',
      lateralSystem: 'braced-frame' as const,
      // Frame only on both towers: this test is about slenderness, and a
      // facade would add weight in proportion to surface area, which is a
      // different effect entirely.
      facade: 'exposed' as const,
    })),
    foundation,
    typology: 'custom',
    exposureCategory: 'C',
  }

  // 2 storeys of reinforced concrete on a 20 x 20 m footprint: 7 m tall.
  const squatHeavy: Structure = {
    storeys: Array.from({ length: 2 }, () => ({
      height_m: 3.5,
      widthX_m: 20,
      widthY_m: 20,
      materialId: 'reinforced-concrete',
      lateralSystem: 'shear-wall' as const,
      facade: 'exposed' as const,
    })),
    foundation,
    typology: 'custom',
    exposureCategory: 'C',
  }

  const tall = analyze(tallLight, hazard, MATERIAL_LIBRARY)
  const squat = analyze(squatHeavy, hazard, MATERIAL_LIBRARY)

  it('the tall lightweight tower fails overturning outright', () => {
    // FoS < 1 means the wind moment already exceeds the restoring moment,
    // never mind the 1.5 target.
    expect(tall.stability.factorOfSafetyOverturning).toBeLessThan(1)
    expect(tall.scoreCard.governingFailureMode).not.toBe('none')
  })

  it('a structure that has already blown over also fails drift, harder', () => {
    // Both checks are breached; drift wins on magnitude. Documented rather
    // than asserted as 'overturning governs', because which of two
    // catastrophic failures scores worse is a property of the calibration,
    // not a structural truth worth pinning a test to.
    expect(tall.stability.factorOfSafetyOverturning).toBeLessThan(1)
    expect(tall.scoreCard.driftRatio).toBeGreaterThan(1 / 500)
    expect(tall.scoreCard.governingFailureMode).toBe('drift')
  })

  it('the squat heavy block does not', () => {
    expect(squat.stability.factorOfSafetyOverturning).toBeGreaterThan(1.5)
    expect(squat.scoreCard.governingFailureMode).not.toBe('overturning')
  })

  it('separates them by more than two orders of magnitude', () => {
    expect(squat.stability.factorOfSafetyOverturning).toBeGreaterThan(
      100 * tall.stability.factorOfSafetyOverturning,
    )
  })

  it('the tower is lighter in absolute terms yet far less stable', () => {
    expect(tall.stability.totalSelfWeight_kN).toBeLessThan(
      squat.stability.totalSelfWeight_kN,
    )
    // ...and it carries a taller lever arm on a narrower base.
    expect(tall.stability.alongWindDepth_m).toBeLessThan(
      squat.stability.alongWindDepth_m,
    )
  })

  it('and the timber tower is still the low-carbon option, which is the tradeoff', () => {
    // The point of the product: the safe choice here is not the green choice.
    expect(tall.scoreCard.carbonKg).toBeLessThan(squat.scoreCard.carbonKg)
    expect(tall.scoreCard.safetyFactor).toBeLessThan(squat.scoreCard.safetyFactor)
  })
})

describe('slenderness is what drives it, not height alone', () => {
  const hazard: WindHazard = {
    kind: 'wind',
    gustSpeed_kmh: 180,
    directionDeg: 0,
    terrainRoughness: 0.02,
  }

  const towerOfWidth = (width: number) =>
    analyze(
      {
        storeys: Array.from({ length: 10 }, () => ({
          height_m: 3.5,
          widthX_m: width,
          widthY_m: width,
          materialId: 'cross-laminated-timber',
          lateralSystem: 'braced-frame' as const,
          facade: 'exposed' as const,
        })),
        foundation: {
          type: 'strip-footing',
          embedmentDepth_m: 0,
          anchorCapacity_kN: 0,
        },
        typology: 'custom',
        exposureCategory: 'C',
      },
      hazard,
      MATERIAL_LIBRARY,
    ).stability.factorOfSafetyOverturning

  it('widening the base monotonically improves overturning safety', () => {
    let previous = -Infinity
    for (let w = 4; w <= 30; w += 1) {
      const fos = towerOfWidth(w)
      expect(fos).toBeGreaterThan(previous)
      previous = fos
    }
  })
})
