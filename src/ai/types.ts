/**
 * The contract between the engine, the prompt and the model.
 *
 * This module has NO imports, on purpose. `prompt.ts` is bundled into the
 * Vite config so the dev-server middleware can build prompts server-side, and
 * anything it reaches for has to be resolvable in that context too. Keeping
 * the shared shapes dependency-free means the same pure code runs in the
 * browser, in Node and in Vitest without conditional imports.
 *
 * `CritiqueContext` is the ONLY thing the model ever sees. Every number in it
 * was produced by `analyze()`. The model's job is to read these figures and
 * explain them; if a quantity is not in here, the model is instructed to
 * describe it in words rather than reach for a value.
 */

export interface CritiqueHazard {
  gustSpeed_kmh: number
  directionDeg: number
  exposureCategory: string
  exposureDescription: string
}

export interface CritiqueBuilding {
  storeyCount: number
  totalHeight_m: number
  planX_m: number
  planY_m: number
  floorArea_m2: number
  slendernessRatio: number
  foundationType: string
  embedmentDepth_m: number
  anchorCapacity_kN: number
}

export interface CritiqueScore {
  safetyFactor: number
  carbon_kgCO2e: number
  carbonIntensity_kgCO2e_m2: number
  cost_usd: number
  costIntensity_usd_m2: number
  worstDriftRatio: number
  /** Denominator form: 500 means h/500. Easier for a model to quote correctly. */
  worstDriftDenominator: number
  governingFailureMode: string
}

export interface CritiqueStability {
  baseShear_kN: number
  overturningMoment_kNm: number
  restoringMoment_kNm: number
  factorOfSafetyOverturning: number
  factorOfSafetySliding: number
  totalSelfWeight_kN: number
}

export interface CritiqueLimits {
  targetSafetyFactor: number
  driftLimitDenominator: number
}

export interface CritiqueStorey {
  /** 1-based, so it matches what the student sees in the table. */
  label: number
  materialName: string
  lateralSystem: string
  /** The envelope, by name. A label, deliberately not a figure. */
  facadeName: string
  lateralForce_kN: number
  storeyShear_kN: number
  driftDenominator: number
  driftUtilization: number
  strengthUtilization: number
  utilization: number
}

/**
 * The library, so suggestions are grounded in materials that actually exist.
 * Without this the model cheerfully recommends carbon fibre.
 */
export interface CritiqueMaterial {
  id: string
  name: string
  structuralClass: string
  density_kg_m3: number
  yieldStrength_MPa: number
  embodiedCarbon_kgCO2e_m3: number
  cost_usd_m3: number
}

export interface CritiqueContext {
  hazard: CritiqueHazard
  building: CritiqueBuilding
  score: CritiqueScore
  stability: CritiqueStability
  limits: CritiqueLimits
  storeys: CritiqueStorey[]
  materials: CritiqueMaterial[]
  /**
   * Envelope systems that exist, by name, so a suggestion to re-clad names one
   * the controls can actually apply. Names only and no figures at all: the
   * guard checks numbers, and a per-m2 rate in here would become a number the
   * model was licensed to quote without the student ever seeing it.
   */
  facadeNames: string[]
  warnings: string[]
}

export interface CritiqueSuggestion {
  change: string
  rationale: string
  /** What it costs elsewhere. A suggestion with no downside is usually wrong. */
  tradeoff: string
}

export interface Critique {
  verdict: string
  explanation: string
  suggestions: CritiqueSuggestion[]
}

/** A figure in the model's prose that does not trace back to the context. */
export interface UntraceableFigure {
  /** The matched text, e.g. "1,240 kN". */
  text: string
  value: number
  unit: string
}

export type CritiqueResult =
  | {
      ok: true
      critique: Critique
      /** False when the model ignored the JSON schema and we fell back to prose. */
      parsedAsJson: boolean
      untraceable: UntraceableFigure[]
    }
  | { ok: false; error: string }
