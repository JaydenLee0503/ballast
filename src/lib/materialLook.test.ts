import { expect, it } from 'vitest'
import { MATERIAL_LIBRARY } from '@/engine'
import { BAND_HEX, type UtilizationBand } from '@/lib/palette.ts'
import {
  MATERIAL_LOOK,
  MATERIAL_TINT_STRENGTH,
  SURFACE_CODE,
  colorDistance,
  materialLook,
  wallColor,
} from '@/lib/materialLook.ts'

const BANDS: readonly UtilizationBand[] = ['safe', 'caution', 'fail']

it('gives every material in the seed library a finish', () => {
  // The point of keying on StructuralClass rather than on material id: every
  // shipped material must resolve, including ones added after this was written.
  for (const entry of MATERIAL_LIBRARY.values()) {
    const look = materialLook(entry.structuralClass)
    expect(look, `no look for ${entry.id}`).toBeDefined()
    expect(SURFACE_CODE[look.surface]).toBeTypeOf('number')
  }
})

it('keeps every finish inside what a standard material can express', () => {
  for (const [name, look] of Object.entries(MATERIAL_LOOK)) {
    expect(look.roughness, name).toBeGreaterThanOrEqual(0)
    expect(look.roughness, name).toBeLessThanOrEqual(1)
    expect(look.metalness, name).toBeGreaterThanOrEqual(0)
    expect(look.metalness, name).toBeLessThanOrEqual(1)
  }
})

it('keeps the set-out subtle enough not to compete with the utilisation band', () => {
  // The whole premise of this module is that material is a finish and never a
  // colour. A relief strong enough to read as a stripe would break that, so
  // the ceiling is asserted rather than left to taste.
  for (const [name, look] of Object.entries(MATERIAL_LOOK)) {
    expect(look.relief, name).toBeGreaterThan(0)
    expect(look.relief, name).toBeLessThanOrEqual(0.25)
  }
})

it('gives the shader one distinct integer per pattern', () => {
  const codes = Object.values(SURFACE_CODE)
  expect(new Set(codes).size).toBe(codes.length)
  for (const code of codes) expect(Number.isInteger(code)).toBe(true)
  // -1 is reserved: windows.ts uses it for "no set-out yet".
  expect(Math.min(...codes)).toBeGreaterThanOrEqual(0)
})

it('distinguishes the classes a student would expect to tell apart', () => {
  // Steel should look nothing like earth; if these ever collapse onto the same
  // finish the feature has quietly stopped working.
  expect(materialLook('steel').metalness).toBeGreaterThan(
    materialLook('earth').metalness,
  )
  expect(materialLook('earth').roughness).toBeGreaterThan(
    materialLook('steel').roughness,
  )
  expect(materialLook('masonry').surface).not.toBe(materialLook('timber').surface)
})

it('never lets a material tint move a storey into another band', () => {
  // The invariant the whole tint idea stands on. A tinted storey must still
  // be nearest its own band: an earth-tinted "caution" that lands closer to
  // "fail" than to "caution" is a building lying about whether it is safe.
  for (const [name, look] of Object.entries(MATERIAL_LOOK)) {
    for (const band of BANDS) {
      const painted = wallColor(BAND_HEX[band], look.tint)
      const ranked = BANDS.map((other) => ({
        other,
        distance: colorDistance(painted, BAND_HEX[other]),
      })).sort((a, b) => a.distance - b.distance)

      expect(ranked[0]?.other, `${name} ${band} reads as another band`).toBe(band)
      // Nearest is not enough on its own — it has to win comfortably, or a
      // shaded face in the 3D view can still cross over.
      expect(
        (ranked[1]?.distance ?? 0) - (ranked[0]?.distance ?? 0),
        `${name} ${band} margin`,
      ).toBeGreaterThan(12)
    }
  }
})

it('tints strongly enough that the material is actually visible', () => {
  // The opposite failure: a tint so timid that asking for material colour
  // produced no material colour.
  for (const [name, look] of Object.entries(MATERIAL_LOOK)) {
    for (const band of BANDS) {
      expect(
        colorDistance(wallColor(BAND_HEX[band], look.tint), BAND_HEX[band]),
        `${name} ${band} is indistinguishable from the untinted band`,
      ).toBeGreaterThan(20)
    }
  }
})

it('keeps the tint strength clear of the cliff', () => {
  // Measured: the band invariant above survives to ~0.56 and fails by 0.58,
  // where tinted amber and tinted red converge.
  expect(MATERIAL_TINT_STRENGTH).toBeGreaterThan(0)
  expect(MATERIAL_TINT_STRENGTH).toBeLessThan(0.56)
})

it('tells the materials apart at the same utilisation', () => {
  // Two structures at identical safety should not be the same colour, or the
  // feature has done nothing.
  const timber = wallColor(BAND_HEX.safe, MATERIAL_LOOK.timber.tint)
  const steel = wallColor(BAND_HEX.safe, MATERIAL_LOOK.steel.tint)
  const masonry = wallColor(BAND_HEX.safe, MATERIAL_LOOK.masonry.tint)
  expect(colorDistance(timber, steel)).toBeGreaterThan(25)
  expect(colorDistance(timber, masonry)).toBeGreaterThan(25)
  expect(colorDistance(steel, masonry)).toBeGreaterThan(25)
})
