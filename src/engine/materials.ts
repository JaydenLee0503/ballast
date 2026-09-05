/**
 * Material library loading and validation.
 *
 * The JSON is the single source of truth for material properties. This module
 * turns it into a typed, indexed, validated library and fails loudly on bad
 * data rather than letting a NaN propagate into a score.
 */

import type { MaterialEntry, MaterialLibrary } from './types.ts'
import libraryJson from './data/materials.json'

/** Fields that must be finite and strictly positive for the engine to work. */
const REQUIRED_POSITIVE_FIELDS = [
  'density_kg_m3',
  'youngsModulus_GPa',
  'yieldStrength_MPa',
  'embodiedCarbon_kgCO2e_m3',
  'cost_usd_m3',
] as const

export class MaterialDataError extends Error {
  override readonly name = 'MaterialDataError'
}

/**
 * Validate one raw library entry. A material whose value is still a TODO
 * placeholder (null) is rejected here rather than silently scoring as zero
 * carbon or zero cost — a missing number must never look like a good number.
 */
function validateEntry(raw: unknown, index: number): MaterialEntry {
  if (typeof raw !== 'object' || raw === null) {
    throw new MaterialDataError(`materials[${index}] is not an object`)
  }
  const entry = raw as Record<string, unknown>
  const id = entry['id']
  if (typeof id !== 'string' || id.length === 0) {
    throw new MaterialDataError(`materials[${index}] has no id`)
  }
  for (const field of REQUIRED_POSITIVE_FIELDS) {
    const value = entry[field]
    if (value === null) {
      throw new MaterialDataError(
        `material "${id}" has an unresolved TODO for ${field}; ` +
          `supply a sourced value before using this material`,
      )
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new MaterialDataError(
        `material "${id}" has a non-positive or non-finite ${field}: ${String(value)}`,
      )
    }
  }
  return entry as unknown as MaterialEntry
}

/**
 * Build a material library from raw JSON-shaped data. Exported so tests (and
 * later, user-defined materials) can build a library without touching the
 * bundled seed file.
 */
export function buildMaterialLibrary(entries: readonly unknown[]): MaterialLibrary {
  const library = new Map<string, MaterialEntry>()
  entries.forEach((raw, index) => {
    const entry = validateEntry(raw, index)
    if (library.has(entry.id)) {
      throw new MaterialDataError(`duplicate material id "${entry.id}"`)
    }
    library.set(entry.id, entry)
  })
  return library
}

/** The bundled seed library. Validated once at module load. */
export const MATERIAL_LIBRARY: MaterialLibrary = buildMaterialLibrary(
  libraryJson.materials,
)

export function getMaterial(
  library: MaterialLibrary,
  materialId: string,
): MaterialEntry {
  const material = library.get(materialId)
  if (material === undefined) {
    throw new MaterialDataError(`unknown materialId "${materialId}"`)
  }
  return material
}
