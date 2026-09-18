/**
 * The whole input space, swept.
 *
 * The other engine tests check particular claims — a hand-worked ELF case, the
 * hydrostatic resultant at d/3, Kz against its power law. This one checks the
 * claims that have no interesting value: across every combination of storey
 * count, material, lateral system, footprint, plan width and hazard at both
 * extremes of its slider, `analyze()` must not produce a NaN, a negative force,
 * a load acting outside the storey it belongs to, or a shear that grows on the
 * way up.
 *
 * It exists because those are exactly the failures a spot check misses and a
 * student finds in thirty seconds of dragging sliders. NaN in particular is the
 * one that hurts: it renders as "NaN" in a dial, propagates into a colour band,
 * and traces back to a divide-by-zero three modules away.
 *
 * Infinity is deliberately allowed. A safety factor at zero load is genuinely
 * infinite, and `compare.ts` and `format.ts` both already have a story for it.
 */

import { describe, expect, it } from 'vitest'
import {
  analyze,
  MATERIAL_LIBRARY,
  type Hazard,
  type LateralSystem,
  type PlanShape,
  type Structure,
} from './index.ts'

const hazards: Hazard[] = [
  { kind: 'wind', gustSpeed_kmh: 0, directionDeg: 0, terrainRoughness: 0.02 },
  { kind: 'wind', gustSpeed_kmh: 300, directionDeg: 37, terrainRoughness: 0.02 },
  { kind: 'seismic', Ss_g: 0, S1_g: 0, siteClass: 'A', directionDeg: 0 },
  { kind: 'seismic', Ss_g: 2.5, S1_g: 1.2, siteClass: 'E', directionDeg: 37 },
  { kind: 'flood', depth_m: 0, velocity_ms: 0, directionDeg: 0 },
  { kind: 'flood', depth_m: 12, velocity_ms: 6, directionDeg: 37 },
]
const materials = ['cross-laminated-timber', 'reinforced-concrete', 'structural-steel', 'rammed-earth']
const systems: LateralSystem[] = ['shear-wall', 'braced-frame', 'moment-frame', 'none']
const shapes: PlanShape[] = ['rectangle', 'ellipse']

function build(n: number, m: string, sys: LateralSystem, shape: PlanShape, w: number): Structure {
  return {
    typology: 'custom',
    storeys: Array.from({ length: n }, () => ({
      height_m: 3.5, widthX_m: w, widthY_m: Math.max(4, w * 0.6),
      planShape: shape, materialId: m, lateralSystem: sys, facade: 'punched' as const,
    })),
    foundation: { type: 'raft', embedmentDepth_m: 1.5, anchorCapacity_kN: 600 },
    exposureCategory: 'C',
  }
}

function finiteOrInf(v: unknown, path: string) {
  if (typeof v === 'number') {
    expect(Number.isNaN(v), `${path} is NaN`).toBe(false)
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => finiteOrInf(x, `${path}[${i}]`))
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) finiteOrInf(x, `${path}.${k}`)
  }
}

describe('sweep', () => {
  it('never produces NaN or an incoherent result', () => {
    let cases = 0
    for (const n of [1, 6, 24]) for (const m of materials) for (const sys of systems)
      for (const shape of shapes) for (const w of [4, 18, 60]) for (const hazard of hazards) {
        const s = build(n, m, sys, shape, w)
        const r = analyze(s, hazard, MATERIAL_LIBRARY)
        cases += 1
        finiteOrInf(r, 'result')
        expect(r.scoreCard.carbonKg, 'carbon').toBeGreaterThan(0)
        expect(r.scoreCard.costUsd, 'cost').toBeGreaterThan(0)
        expect(r.scoreCard.safetyFactor, 'FoS').toBeGreaterThanOrEqual(0)
        expect(r.scoreCard.driftRatio, 'drift').toBeGreaterThanOrEqual(0)
        expect(r.damage.storeys).toHaveLength(n)
        expect(r.driftLimitRatio).toBeGreaterThan(0)
        for (const st of r.storeys) {
          expect(st.lateralForce_kN, 'force >= 0').toBeGreaterThanOrEqual(0)
          expect(st.loadElevation_m, 'load below base').toBeGreaterThanOrEqual(st.baseElevation_m)
          expect(st.loadElevation_m, 'load above top').toBeLessThanOrEqual(st.baseElevation_m + st.height_m + 1e-9)
        }
        // Shear accumulates downward: the ground storey carries the most.
        for (let i = 1; i < r.storeys.length; i += 1) {
          expect(r.storeys[i]!.storeyShear_kN).toBeLessThanOrEqual(r.storeys[i - 1]!.storeyShear_kN + 1e-6)
        }
      }
    console.log('cases swept:', cases)
  })
})
