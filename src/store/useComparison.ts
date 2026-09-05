/**
 * The current design measured against the baseline.
 *
 * Like `useAnalysis`, this derives rather than stores: the baseline's analysis
 * is recomputed and memoised on object identity. Two analyses per render
 * sounds wasteful and is not — the engine is pure arithmetic over a handful of
 * storeys, and the alternative is caching a ScoreCard that can go stale, which
 * is the one thing the architecture refuses to do.
 *
 * The comparison is null while the design *is* the baseline. A row of "0%"
 * against something you have not changed yet is noise pretending to be
 * information; the panel says "this is the baseline" instead.
 */

import { useMemo } from 'react'
import {
  analyze,
  compareDesigns,
  MATERIAL_LIBRARY,
  type AnalysisResult,
  type DesignComparison,
  type Structure,
} from '@/engine'
import { useDesignStore } from './design.ts'

export interface ComparisonState {
  comparison: DesignComparison | null
  /** Where the baseline came from, e.g. "Starting design". */
  baselineLabel: string
  /** True when the design on screen is the baseline itself. */
  isBaseline: boolean
}

/**
 * `result` is nullable because hooks cannot be called conditionally and
 * `useAnalysis` returns null on a design the engine rejects. There is nothing
 * to compare against in that case, and the page is showing an error anyway.
 */
export function useComparison(
  result: AnalysisResult | null,
  structure: Structure,
): ComparisonState {
  const baseline = useDesignStore((state) => state.baseline)
  const hazard = useDesignStore((state) => state.hazard)

  return useMemo<ComparisonState>(() => {
    // Identity, not deep equality: every store action replaces the object it
    // touches, so "same object" and "unchanged" are the same question.
    const isBaseline =
      structure === baseline.structure && hazard === baseline.hazard

    // Nothing to compare, but the design on screen is not therefore the
    // baseline — report what is actually true about each.
    if (result === null) {
      return { comparison: null, baselineLabel: baseline.label, isBaseline }
    }
    if (isBaseline) {
      return { comparison: null, baselineLabel: baseline.label, isBaseline: true }
    }

    try {
      const baselineResult = analyze(
        baseline.structure,
        baseline.hazard,
        MATERIAL_LIBRARY,
      )
      return {
        comparison: compareDesigns(
          { result: baselineResult, structure: baseline.structure },
          { result, structure },
        ),
        baselineLabel: baseline.label,
        isBaseline: false,
      }
    } catch {
      // A baseline that no longer analyses is not worth breaking the page for.
      // It can only happen if a design got in without passing the parser, which
      // is a bug to fix at the source rather than to render an error about.
      return { comparison: null, baselineLabel: baseline.label, isBaseline: false }
    }
  }, [baseline, hazard, result, structure])
}
