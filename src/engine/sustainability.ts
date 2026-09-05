/**
 * Quantity take-off, embodied carbon and cost.
 *
 * The chain is deliberately short and auditable:
 *   gross volume -> structural volume -> mass, carbon, cost
 * Each step is one multiplication with a documented factor, so a student can
 * follow the arithmetic from a slider to a kilogram of CO2e.
 *
 * SCOPE: A1-A3 (cradle to gate) embodied carbon of the *structural frame
 * only*. Not counted: foundations below the storey stack, facade, finishes,
 * services, transport to site (A4), construction (A5), maintenance,
 * demolition, or biogenic sequestration in the timber and bamboo entries.
 * A real whole-building figure would be substantially higher.
 */

import type { MaterialEntry, Storey, Structure } from './types.ts'
import { GRAVITY_M_S2, STRUCTURAL_FRACTION } from './constants.ts'

/** Enclosed volume of a storey, before any structural fraction is applied. */
export function grossVolume_m3(storey: Storey): number {
  return storey.height_m * storey.widthX_m * storey.widthY_m
}

/**
 * Gross internal floor area, summed over the storey stack.
 *
 * Not a physical result — it is plan geometry — but it lives here because it
 * is the denominator for carbon and cost *intensity* (kgCO2e/m2, $/m2), and
 * intensity is how the profession benchmarks. Totals alone cannot compare a
 * six-storey design with a twelve-storey one, which is exactly the comparison
 * the student is being asked to make. Keeping it in the engine means every
 * number on screen still traces back to this module.
 *
 * Counts the full plan rectangle of every storey, with no deduction for
 * cores, stairs or the walls themselves.
 */
export function grossFloorArea_m2(structure: Structure): number {
  return structure.storeys.reduce(
    (total, storey) => total + storey.widthX_m * storey.widthY_m,
    0,
  )
}

/**
 * Structural material volume:
 *   V = h * widthX * widthY * fraction(class, lateralSystem)
 * See STRUCTURAL_FRACTION in constants.ts for how the fractions were chosen.
 */
export function structuralVolume_m3(
  storey: Storey,
  structuralClass: MaterialEntry['structuralClass'],
): number {
  const fraction = STRUCTURAL_FRACTION[structuralClass][storey.lateralSystem]
  return grossVolume_m3(storey) * fraction
}

export interface StoreyQuantities {
  materialVolume_m3: number
  mass_kg: number
  selfWeight_kN: number
  embodiedCarbon_kgCO2e: number
  cost_usd: number
}

export function storeyQuantities(
  storey: Storey,
  material: MaterialEntry,
): StoreyQuantities {
  const volume = structuralVolume_m3(storey, material.structuralClass)
  const mass = volume * material.density_kg_m3
  return {
    materialVolume_m3: volume,
    mass_kg: mass,
    // W = m * g, in kN.
    selfWeight_kN: (mass * GRAVITY_M_S2) / 1000,
    embodiedCarbon_kgCO2e: volume * material.embodiedCarbon_kgCO2e_m3,
    cost_usd: volume * material.cost_usd_m3,
  }
}
