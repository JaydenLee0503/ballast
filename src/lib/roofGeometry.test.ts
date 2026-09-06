import { expect, it } from 'vitest'
import { gablePrism, monoPrism, type RoofPrism } from '@/lib/roofGeometry.ts'

type Vec = readonly [number, number, number]

function vertices(prism: RoofPrism): Vec[] {
  const out: Vec[] = []
  for (let i = 0; i < prism.positions.length; i += 3) {
    out.push([
      prism.positions[i] ?? Number.NaN,
      prism.positions[i + 1] ?? Number.NaN,
      prism.positions[i + 2] ?? Number.NaN,
    ])
  }
  return out
}

/** Face normal from the winding, so "which way does this face point" is testable. */
function normals(prism: RoofPrism): Vec[] {
  const v = vertices(prism)
  const out: Vec[] = []
  for (let i = 0; i < v.length; i += 3) {
    const [a, b, c] = [v[i], v[i + 1], v[i + 2]] as [Vec, Vec, Vec]
    const e1: Vec = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const e2: Vec = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    out.push([
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ])
  }
  return out
}

it('builds whole triangles and no NaN', () => {
  for (const prism of [gablePrism(11, 9, 0.3, 4.5), monoPrism(56, 36, 0.09, 3.5)]) {
    expect(prism.positions.length % 9).toBe(0)
    expect(prism.positions.every((n) => Number.isFinite(n))).toBe(true)
  }
})

it('runs a gable ridge down the longer plan dimension', () => {
  // A ridge across the short way is the mistake that made the townhouse look
  // like a spike, so it is asserted rather than eyeballed.
  expect(gablePrism(11, 9, 0.3, 4.5).rotationY).toBe(0)
  expect(gablePrism(7, 12, 0.3, 4.5).rotationY).toBeCloseTo(Math.PI / 2, 10)
})

it('pitches a gable off the span the slope has to climb', () => {
  // The short side, not the long one: a 7 x 12 house is a 7 m climb.
  expect(gablePrism(7, 12, 0.3, 4.5).rise_m).toBeCloseTo(2.1, 10)
  expect(gablePrism(11, 9, 0.3, 4.5).rise_m).toBeCloseTo(2.7, 10)
  // And never becomes a spire on a wide plan.
  expect(gablePrism(44, 40, 0.3, 4.5).rise_m).toBe(4.5)
})

it('gives a gable a ridge line, not an apex point', () => {
  // The whole bug in one assertion. A pyramid has one highest vertex; a gable
  // has two, and the roof between them is a line.
  const prism = gablePrism(7, 12, 0.3, 4.5)
  const top = prism.rise_m
  const ridge = new Set(
    vertices(prism)
      .filter((v) => Math.abs(v[1] - top) < 1e-9)
      .map((v) => `${v[0]},${v[2]}`),
  )
  expect(ridge.size).toBe(2)
})

it('keeps every roof vertex over the building, never past its walls', () => {
  const prism = gablePrism(7, 12, 0.3, 4.5)
  // Built along local X, so the long span is X here and rotationY turns it.
  for (const [x, y, z] of vertices(prism)) {
    expect(Math.abs(x)).toBeLessThanOrEqual(12 / 2 + 1e-9)
    expect(Math.abs(z)).toBeLessThanOrEqual(7 / 2 + 1e-9)
    expect(y).toBeGreaterThanOrEqual(0)
  }
})

it('sits a gable down on the wall top rather than floating', () => {
  const prism = gablePrism(11, 9, 0.3, 4.5)
  expect(Math.min(...vertices(prism).map((v) => v[1]))).toBe(0)
})

it('falls a monopitch across the short span, and sits it on both walls', () => {
  // 56 x 36 pitched the long way would put the ridge four storeys up.
  const prism = monoPrism(56, 36, 0.09, 3.5)
  expect(prism.rise_m).toBeCloseTo(3.24, 10)
  expect(prism.rotationY).toBeCloseTo(Math.PI / 2, 10)

  const ys = vertices(prism).map((v) => v[1])
  // Solid wedge: the underside is the wall top, so there is no gap to see.
  expect(Math.min(...ys)).toBe(0)
  expect(Math.max(...ys)).toBeCloseTo(prism.rise_m, 10)
})

it('points every sloping face upwards, not into the building', () => {
  // Backwards winding renders a roof lit from underneath and dark on top —
  // wrong in a way nothing throws about.
  for (const prism of [gablePrism(11, 9, 0.3, 4.5), monoPrism(56, 36, 0.09, 3.5)]) {
    const upward = normals(prism).filter((n) => n[1] > 1e-9)
    // Both solids have sloping faces, and none of them may face downwards.
    expect(upward.length).toBeGreaterThan(0)
    expect(normals(prism).every((n) => n[1] >= -1e-9)).toBe(true)
  }
})
