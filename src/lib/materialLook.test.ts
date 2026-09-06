import { expect, it } from 'vitest'
import { MATERIAL_LIBRARY } from '@/engine'
import { MATERIAL_LOOK, SURFACE_CODE, materialLook } from '@/lib/materialLook.ts'

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
