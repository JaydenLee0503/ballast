import { expect, it } from 'vitest'
import {
  BLANK_NEIGHBOURS,
  GLAZED_NEIGHBOURS,
  NEIGHBOURS,
  PAVEMENT_OFFSET_M,
  PEDESTRIANS,
  ROAD_CENTRES_M,
  ROAD_HALF_M,
  WALK_SPAN_M,
  walkOffset_m,
} from './scenery.ts'

it('splits the neighbourhood into glazed and blank without losing a building', () => {
  expect(GLAZED_NEIGHBOURS.length + BLANK_NEIGHBOURS.length).toBe(
    NEIGHBOURS.length,
  )
  // Both kinds have to actually occur, or the street is uniform again — which
  // is the thing having two kinds was for.
  expect(GLAZED_NEIGHBOURS.length).toBeGreaterThan(0)
  expect(BLANK_NEIGHBOURS.length).toBeGreaterThan(0)
  expect(GLAZED_NEIGHBOURS.every((b) => b.glazed)).toBe(true)
  expect(BLANK_NEIGHBOURS.every((b) => !b.glazed)).toBe(true)
})

it('keeps blank walls the minority, so the city still reads as a city', () => {
  const blankShare = BLANK_NEIGHBOURS.length / NEIGHBOURS.length
  expect(blankShare).toBeGreaterThan(0.05)
  expect(blankShare).toBeLessThan(0.4)
})

it('walks people on the pavement and never in the carriageway', () => {
  expect(PEDESTRIANS.length).toBeGreaterThan(0)
  for (const walker of PEDESTRIANS) {
    const nearest = ROAD_CENTRES_M.reduce((best, centre) =>
      Math.abs(centre - walker.across_m) < Math.abs(best - walker.across_m)
        ? centre
        : best,
    )
    const fromCentreline = Math.abs(walker.across_m - nearest)
    // Clear of the asphalt by construction: the pavement centre sits further
    // out than the road's half-width.
    expect(fromCentreline).toBeCloseTo(PAVEMENT_OFFSET_M, 6)
    expect(fromCentreline).toBeGreaterThan(ROAD_HALF_M)
  }
})

it('wraps a walker back onto the street however long it runs, in both directions', () => {
  const half = WALK_SPAN_M / 2
  for (const walker of PEDESTRIANS) {
    for (const seconds of [0, 1, 37, 600, 12_000, 250_000]) {
      const along = walkOffset_m(walker, seconds)
      expect(Number.isFinite(along)).toBe(true)
      expect(along).toBeGreaterThanOrEqual(-half)
      expect(along).toBeLessThan(half)
    }
  }
})

it('moves each walker in the direction it was given', () => {
  for (const walker of PEDESTRIANS) {
    // A step short enough that it cannot cross the wrap seam.
    const before = walkOffset_m(walker, 0)
    const after = walkOffset_m(walker, 0.05)
    const wrapped = Math.abs(after - before) > WALK_SPAN_M / 2
    if (wrapped) continue
    expect(Math.sign(after - before)).toBe(walker.direction)
  }
})

it('lays out the same city on every load', () => {
  // The seeded generators are the whole reason this is a module constant, and
  // fixed counts are the cheapest way to notice one of them moving: a stray
  // Math.random, or a new draw taken from an existing stream rather than its
  // own, changes these immediately. Glazing in particular runs on a separate
  // generator precisely so that adding it left the streets where they were.
  expect(NEIGHBOURS.length).toBe(151)
  expect(GLAZED_NEIGHBOURS.length).toBe(107)
  expect(BLANK_NEIGHBOURS.length).toBe(44)
  expect(PEDESTRIANS.length).toBe(64)
})
