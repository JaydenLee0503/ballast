/**
 * Shared fixtures for the AI-layer tests. Not a test file itself -- the
 * vitest `include` glob only picks up *.test.ts, so this name keeps it out of
 * the run while still living next to what it serves.
 */

import { analyze, MATERIAL_LIBRARY, type Structure, type WindHazard } from '@/engine'
import { buildCritiqueContext } from './context.ts'
import type { Critique, CritiqueContext } from './types.ts'

export const DEMO_STRUCTURE: Structure = {
  storeys: Array.from({ length: 6 }, () => ({
    height_m: 3.5,
    widthX_m: 18,
    widthY_m: 12,
    materialId: 'cross-laminated-timber',
    lateralSystem: 'shear-wall' as const,
    facade: 'exposed' as const, planShape: 'rectangle',
  })),
  foundation: { type: 'raft', embedmentDepth_m: 1.5, anchorCapacity_kN: 600 },
  typology: 'custom',
  exposureCategory: 'C',
}

export const DEMO_HAZARD: WindHazard = {
  kind: 'wind',
  gustSpeed_kmh: 150,
  directionDeg: 0,
  terrainRoughness: 0.02,
}

export function demoContext(): CritiqueContext {
  const result = analyze(DEMO_STRUCTURE, DEMO_HAZARD, MATERIAL_LIBRARY)
  return buildCritiqueContext(result, DEMO_STRUCTURE, DEMO_HAZARD, MATERIAL_LIBRARY)
}

/** A critique whose only content is the sentence under test. */
export function says(text: string): Critique {
  return { verdict: '', explanation: text, suggestions: [] }
}
