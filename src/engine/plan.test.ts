/**
 * Plan geometry, checked against the closed forms it claims to implement.
 *
 * The reason this file exists rather than trusting the formulas: `plan.ts` is
 * the one module every other part of the engine asks about shape, so an error
 * in it shows up as a carbon figure, a wind force, a stiffness and a safety
 * factor all at once, all plausible and all wrong together.
 */

import { describe, expect, it } from 'vitest'
import {
  grossSectionModulus_m3,
  planArea_m2,
  planPerimeter_m,
  projectPlan,
} from './plan.ts'
import type { PlanShape, Storey } from './types.ts'

const storey = (planShape: PlanShape, widthX_m = 30, widthY_m = 10): Storey => ({
  height_m: 3.5,
  widthX_m,
  widthY_m,
  materialId: 'reinforced-concrete',
  lateralSystem: 'shear-wall',
  facade: 'exposed',
  planShape,
})

describe('plan area', () => {
  it('is the rectangle for a rectangle', () => {
    expect(planArea_m2(storey('rectangle'))).toBe(300)
  })

  it('is pi/4 of the enclosing rectangle for an ellipse', () => {
    expect(planArea_m2(storey('ellipse'))).toBeCloseTo((Math.PI / 4) * 300, 10)
    // The number worth remembering: a round plan is 78.5% of the box it fits in.
    expect(planArea_m2(storey('ellipse')) / 300).toBeCloseTo(0.7854, 4)
  })

  it('gives a circle the textbook pi r^2', () => {
    expect(planArea_m2(storey('ellipse', 20, 20))).toBeCloseTo(Math.PI * 100, 10)
  })
})

describe('plan perimeter', () => {
  it('is 2(X + Y) for a rectangle', () => {
    expect(planPerimeter_m(storey('rectangle'))).toBe(80)
  })

  it('is 2 pi r for a circle', () => {
    // Ramanujan's approximation is exact when the axes are equal.
    expect(planPerimeter_m(storey('ellipse', 20, 20))).toBeCloseTo(2 * Math.PI * 10, 10)
  })

  /** Arc length of x = a cos t, y = b sin t, integrated finely. */
  function integratedPerimeter(a: number, b: number): number {
    const steps = 1_000_000
    let total = 0
    for (let i = 0; i < steps; i += 1) {
      const t = (2 * Math.PI * i) / steps
      const dx = -a * Math.sin(t)
      const dy = b * Math.cos(t)
      total += Math.sqrt(dx * dx + dy * dy) * ((2 * Math.PI) / steps)
    }
    return total
  }

  it('matches a numerically integrated ellipse at every reachable ratio', () => {
    // The table in the module header, checked. 15:1 is the worst case the plan
    // limits allow (60 m by 4 m) and is where an approximation is under most
    // strain; a 3:1 plan is what an ordinary design looks like.
    const worst: ReadonlyArray<readonly [number, number, number]> = [
      [12, 12, 1e-10],
      [30, 10, 1e-7],
      [40, 12, 1e-6],
      [60, 4, 5e-5],
    ]
    for (const [x, y, tolerance] of worst) {
      const exact = integratedPerimeter(x / 2, y / 2)
      const relative =
        Math.abs(planPerimeter_m(storey('ellipse', x, y)) - exact) / exact
      expect(relative).toBeLessThan(tolerance)
    }
  })

  it('beats the approximation it is easy to reach for', () => {
    // Ramanujan's *first*, the one usually quoted. Kept as a test rather than as
    // a comment so "the better one is worth the extra line" stays a measured
    // claim: at the 15:1 extreme the first is out by more than a part in 1000.
    const first = (a: number, b: number) =>
      Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
    const exact = integratedPerimeter(30, 2)
    expect(Math.abs(first(30, 2) - exact) / exact).toBeGreaterThan(1e-3)
    expect(
      Math.abs(planPerimeter_m(storey('ellipse', 60, 4)) - exact) / exact,
    ).toBeLessThan(1e-4)
  })

  it('is always less than the rectangle that contains it', () => {
    for (const [x, y] of [[30, 10], [12, 12], [60, 4], [8, 40]] as const) {
      expect(planPerimeter_m(storey('ellipse', x, y))).toBeLessThan(
        planPerimeter_m(storey('rectangle', x, y)),
      )
    }
  })
})

describe('projection onto the wind', () => {
  it('agrees with the plan dimensions head-on, whatever the shape', () => {
    // 0 degrees blows along X, so the face it meets is the full Y dimension.
    for (const shape of ['rectangle', 'ellipse'] as const) {
      const head = projectPlan(30, 10, 0, shape)
      expect(head.acrossWindWidth_m).toBeCloseTo(10, 10)
      expect(head.alongWindDepth_m).toBeCloseTo(30, 10)
      const side = projectPlan(30, 10, 90, shape)
      expect(side.acrossWindWidth_m).toBeCloseTo(30, 10)
      expect(side.alongWindDepth_m).toBeCloseTo(10, 10)
    }
  })

  it('gives a circle the same silhouette from every direction', () => {
    for (let deg = 0; deg <= 360; deg += 7) {
      const p = projectPlan(20, 20, deg, 'ellipse')
      expect(p.acrossWindWidth_m).toBeCloseTo(20, 10)
      expect(p.alongWindDepth_m).toBeCloseTo(20, 10)
    }
  })

  it('never presents a wider face than the rectangle around it', () => {
    for (let deg = 0; deg <= 360; deg += 5) {
      const round = projectPlan(30, 10, deg, 'ellipse')
      const box = projectPlan(30, 10, deg, 'rectangle')
      expect(round.acrossWindWidth_m).toBeLessThanOrEqual(box.acrossWindWidth_m + 1e-9)
    }
  })

  it('is symmetric under a half turn', () => {
    for (const shape of ['rectangle', 'ellipse'] as const) {
      const a = projectPlan(17, 6, 30, shape)
      const b = projectPlan(17, 6, 210, shape)
      expect(a.acrossWindWidth_m).toBeCloseTo(b.acrossWindWidth_m, 10)
      expect(a.alongWindDepth_m).toBeCloseTo(b.alongWindDepth_m, 10)
    }
  })
})

describe('section modulus', () => {
  it('is B L^2 / 6 for a rectangle', () => {
    expect(grossSectionModulus_m3(10, 30, 'rectangle')).toBeCloseTo((10 * 30 * 30) / 6, 10)
  })

  it('is pi B L^2 / 32 for an ellipse', () => {
    expect(grossSectionModulus_m3(10, 30, 'ellipse')).toBeCloseTo(
      (Math.PI * 10 * 30 * 30) / 32,
      10,
    )
  })

  it('leaves an ellipse weaker than its bounding rectangle, by 6 pi / 32', () => {
    const ratio =
      grossSectionModulus_m3(10, 30, 'ellipse') /
      grossSectionModulus_m3(10, 30, 'rectangle')
    expect(ratio).toBeCloseTo((6 * Math.PI) / 32, 10)
    expect(ratio).toBeLessThan(1)
  })
})
