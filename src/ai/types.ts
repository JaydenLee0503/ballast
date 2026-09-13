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

/**
 * The event, as the model is allowed to see it.
 *
 * A flat record rather than a discriminated union, with the fields that do not
 * apply simply absent — because `guard.ts` walks this object for numbers by
 * field name, and a union would need every branch spelled out there too. What
 * matters is that every numeric field still carries its unit suffix: rename
 * `depth_m` to `depth` and the guard quietly stops being able to check a figure
 * the model quotes about it.
 *
 * `kind` and `description` are the only strings that decide anything: the
 * prompt reads them to say which event it is talking about.
 */
export interface CritiqueHazard {
  kind: string
  /** One sentence naming the event, for the top of the fact sheet. */
  description: string
  /** Which way it acts, in the plan frame. Dimensionless by convention here. */
  directionDeg: number

  /** Wind only. */
  gustSpeed_kmh?: number
  exposureCategory?: string
  exposureDescription?: string

  /** Seismic only. */
  Ss_g?: number
  S1_g?: number
  SDS_g?: number
  SD1_g?: number
  siteClass?: string
  siteDescription?: string
  /**
   * ASCE 7-16 R, deliberately NOT named `...Factor`: `bucketForKey` files
   * anything matching /factor/ with the safety factors, and an R of 5 sitting
   * in that bucket would excuse a model that invented "a safety factor of 5".
   */
  responseModificationR?: number
  approximatePeriod_s?: number

  /** Flood only. */
  depth_m?: number
  velocity_ms?: number
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
  /** Flood only: the uplift, and the check it drives. */
  buoyancy_kN?: number
  factorOfSafetyFlotation?: number
}

export interface CritiqueLimits {
  targetSafetyFactor: number
  /**
   * Denominator form of the limit THIS analysis used, not a constant: wind is
   * checked at h/500 and an earthquake at h/50, so a fixed 500 here would have
   * the model telling a student their seismic drift was ten times over a limit
   * it was never measured against.
   */
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
