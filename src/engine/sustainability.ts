/**
 * Quantity take-off, embodied carbon and cost.
 *
 * The chain is deliberately short and auditable:
 *   gross volume -> structural volume -> mass, carbon, cost
 * Each step is one multiplication with a documented factor, so a student can
 * follow the arithmetic from a slider to a kilogram of CO2e.
 *
 * SCOPE: A1-A3 (cradle to gate) embodied carbon of the *structural frame plus
 * the external envelope*. Not counted: foundations below the storey stack,
 * internal finishes, services, transport to site (A4), construction (A5),
 * maintenance, demolition, or biogenic sequestration in the timber and bamboo
 * entries. A real whole-building figure would still be substantially higher.
 *
 * Frame and facade are computed by separate functions and summed by
 * `analyze()`, rather than by one function that knows about both. They come
 * from different kinds of data — a per-m3 material library with a citation per
 * field, and a per-m2 assembly table that is frankly an estimate — and keeping
 * the arithmetic apart is what lets the result report the split so a student
 * can see which half a number came from.
 */

import type { MaterialEntry, Storey, Structure } from './types.ts'
import { FACADE, GRAVITY_M_S2, STRUCTURAL_FRACTION } from './constants.ts'

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

/**
 * External wall area of a storey: the perimeter times its height.
 *
 * No roof and no soffit — the envelope modelled here is the vertical skin, the
 * part a window goes in and the part the student is choosing. A roof would add
 * area to the topmost storey only and would not change any comparison the
 * product asks anyone to make.
 */
export function facadeArea_m2(storey: Storey): number {
  return 2 * (storey.widthX_m + storey.widthY_m) * storey.height_m
}

export interface FacadeQuantities {
  facadeArea_m2: number
  embodiedCarbon_kgCO2e: number
  cost_usd: number
  selfWeight_kN: number
}

/**
 * The envelope's contribution, as three multiplications of one area.
 *
 * Note what is *not* here: any effect on stiffness. The facade hangs off the
 * frame in this model and carries no lateral load, so it cannot change drift.
 * It reaches the structural result through its weight alone — see the note on
 * `FacadeSystem` in types.ts, and `stability.ts`, where that weight becomes
 * restoring moment and base friction.
 */
export function facadeQuantities(storey: Storey): FacadeQuantities {
  const area = facadeArea_m2(storey)
  const properties = FACADE[storey.facade]
  return {
    facadeArea_m2: area,
    embodiedCarbon_kgCO2e: area * properties.embodiedCarbon_kgCO2e_m2,
    cost_usd: area * properties.cost_usd_m2,
    selfWeight_kN: area * properties.selfWeight_kN_m2,
  }
}
