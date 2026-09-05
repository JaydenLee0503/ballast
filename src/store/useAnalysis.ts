/**
 * The bridge between the store and the engine.
 *
 * `analyze()` is a pure function of (structure, hazard), so it is recomputed
 * rather than stored. The memo key is object identity, which works because
 * every action in design.ts replaces the structure instead of mutating it.
 *
 * The try/catch is not defensive padding: `analyze()` throws
 * StructureValidationError on input it will not stand behind, and a thrown
 * error in render is a blank white page. The store's clamps should make that
 * unreachable — if this ever returns an error, that is a real bug worth
 * reading, not a state to design around.
 */

import { useMemo } from 'react'
import { analyze, MATERIAL_LIBRARY, type AnalysisResult } from '@/engine'
import { useDesignStore } from './design.ts'

export interface AnalysisState {
  result: AnalysisResult | null
  error: string | null
}

export function useAnalysis(): AnalysisState {
  const structure = useDesignStore((state) => state.structure)
  const hazard = useDesignStore((state) => state.hazard)

  return useMemo<AnalysisState>(() => {
    try {
      return { result: analyze(structure, hazard, MATERIAL_LIBRARY), error: null }
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }, [structure, hazard])
}
