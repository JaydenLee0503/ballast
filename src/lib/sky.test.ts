import { expect, it } from 'vitest'
import {
  DAYLIGHT_CEILING_M,
  NIGHTFALL_HEIGHT_M,
  nightProgress,
  relativeLuminance,
  skyBrightness,
  skyPalette,
  sunDirection,
} from '@/lib/sky.ts'

it('holds midday until the building is worth calling a building, and bottoms out at night', () => {
  expect(nightProgress(0)).toBe(0)
  expect(nightProgress(DAYLIGHT_CEILING_M)).toBe(0)
  expect(nightProgress(NIGHTFALL_HEIGHT_M)).toBe(1)
  expect(nightProgress(1000)).toBe(1)
  // A degenerate structure must not produce a NaN sky.
  expect(nightProgress(Number.NaN)).toBe(0)
  expect(nightProgress(-5)).toBe(0)
})

/**
 * Colours are 8-bit per channel, so a step small enough that the true blend
 * moves less than one level can round *up*. That is quantisation, not the sky
 * getting brighter; one level of luminance headroom absorbs it, and the coarse
 * check below is strict where the signal is real.
 */
const ONE_COLOUR_LEVEL = 1 / 255

it('darkens with height, and never brightens by more than a rounding step', () => {
  let previous = Number.POSITIVE_INFINITY
  for (let height_m = 0; height_m <= 140; height_m += 2) {
    const t = nightProgress(height_m)
    expect(t).toBeGreaterThanOrEqual(0)
    expect(t).toBeLessThanOrEqual(1)
    const brightness = skyBrightness(skyPalette(t))
    expect(brightness).toBeLessThanOrEqual(previous + ONE_COLOUR_LEVEL)
    previous = brightness
  }
})

it('darkens strictly over any height difference a student would notice', () => {
  const brightnessAt = (height_m: number) =>
    skyBrightness(skyPalette(nightProgress(height_m)))

  for (const [shorter, taller] of [
    [20, 40],
    [40, 60],
    [60, 80],
    [80, 96],
  ]) {
    expect(brightnessAt(taller as number)).toBeLessThan(brightnessAt(shorter as number))
  }
})

it('is the property the scenery exists for: the sky, the light and the stars all agree', () => {
  const noon = skyPalette(0)
  const night = skyPalette(1)

  expect(skyBrightness(night)).toBeLessThan(skyBrightness(noon))
  expect(relativeLuminance(night.zenith)).toBeLessThan(relativeLuminance(noon.zenith))
  expect(night.keyIntensity).toBeLessThan(noon.keyIntensity)
  expect(night.ambientIntensity).toBeLessThan(noon.ambientIntensity)
  expect(night.starOpacity).toBeGreaterThan(noon.starOpacity)
  expect(night.windowGlow).toBeGreaterThan(noon.windowGlow)
})

it('never brightens the key light or hides the stars again on the way up', () => {
  let key = Number.POSITIVE_INFINITY
  let stars = Number.NEGATIVE_INFINITY
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const palette = skyPalette(t)
    expect(palette.keyIntensity).toBeLessThanOrEqual(key + 1e-9)
    expect(palette.starOpacity).toBeGreaterThanOrEqual(stars - 1e-9)
    key = palette.keyIntensity
    stars = palette.starOpacity
  }
})

it('clamps out-of-range and non-finite progress to an endpoint rather than extrapolating', () => {
  expect(skyPalette(-1)).toEqual(skyPalette(0))
  expect(skyPalette(2)).toEqual(skyPalette(1))
  expect(skyPalette(Number.NaN)).toEqual(skyPalette(0))
})

it('keeps every interpolated colour inside the 24-bit range', () => {
  for (let t = 0; t <= 1.0001; t += 0.005) {
    const { zenith, horizon, key } = skyPalette(t)
    for (const channel of [zenith, horizon, key]) {
      expect(Number.isInteger(channel)).toBe(true)
      expect(channel).toBeGreaterThanOrEqual(0)
      expect(channel).toBeLessThanOrEqual(0xffffff)
    }
  }
})

it('sinks the sun toward the horizon without letting it set', () => {
  const noon = sunDirection(0)
  const dusk = sunDirection(1)

  expect(Math.hypot(noon.x, noon.y, noon.z)).toBeCloseTo(1, 12)
  expect(Math.hypot(dusk.x, dusk.y, dusk.z)).toBeCloseTo(1, 12)
  expect(dusk.y).toBeLessThan(noon.y)
  // Above the horizon throughout: a key light from below would light the
  // undersides of the storeys and shadow the ground.
  expect(dusk.y).toBeGreaterThan(0)
  // Same bearing all day, so the building's shadow does not swing across the
  // plot as storeys are added.
  expect(Math.atan2(noon.x, noon.z)).toBeCloseTo(Math.atan2(dusk.x, dusk.z), 12)
})
