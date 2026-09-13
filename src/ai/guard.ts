/**
 * The check on the one rule.
 *
 * The prompt tells the model never to produce a number. This verifies it.
 * Every figure in the reply that carries an engineering unit is matched
 * against the values in the CritiqueContext it was given; anything that does
 * not trace back is reported, and the UI marks the critique as containing
 * unverified figures.
 *
 * MATCHING IS UNIT-SCOPED. A claimed force is only ever compared against the
 * forces in the context, a claimed cost only against costs. Pooling every
 * number into one set would let an invented base shear of 2280 kN be excused
 * because reinforced concrete happens to weigh 2280 kg/m3 -- with a material
 * library in the context there are hundreds of such coincidences, and a guard
 * that can be satisfied by an unrelated number is not a guard. Units come
 * from the field names, which the project already requires to carry them.
 *
 * Scope is deliberate. Bare integers are ignored -- "storey 4" and "two of
 * the three dials" are prose, not claims about the physics. What gets checked
 * is anything shaped like a quantity: a number with a unit, a drift ratio
 * written h/N, or a stated safety factor. A false positive costs a caution
 * note the student can ignore; a false negative is a fabricated safety factor
 * presented as fact, so the detectors lean strict.
 *
 * TWO CALLERS, ONE SET OF DETECTORS. `findUntraceableFigures` checks a critique
 * against the engine facts it was given; `findUnbackedFigures` is the same
 * machinery pointed at any prose and any object of figures, which is how
 * `ai/blueprint/parse.ts` catches a proposed design that helpfully predicts its
 * own safety factor. A second implementation would be a second thing to weaken.
 *
 * Pure and import-free apart from types.
 */

import type { Critique, CritiqueContext, UntraceableFigure } from './types.ts'

/**
 * Dimension buckets. `count` and `other` exist so that ordinals, storey
 * counts and bearings are collected but never used to justify a quantity.
 */
type Bucket =
  | 'force'
  | 'moment'
  | 'mass'
  | 'length'
  | 'area'
  | 'volume'
  | 'money'
  | 'moneyIntensity'
  | 'moneyDensity'
  | 'speed'
  /**
   * Kept apart from `speed` on purpose. A gust is quoted in km/h and a flood
   * current in m/s, and pooling them would let "1.5 m/s" be excused by a
   * 1.5 km/h that is not in the context either — worse, by an unrelated figure
   * that happens to share the number. Two ways of writing a velocity that never
   * appear in the same sentence are two buckets.
   */
  | 'flowSpeed'
  | 'acceleration'
  | 'time'
  | 'stress'
  | 'density'
  | 'carbonIntensity'
  | 'carbonDensity'
  | 'ratio'
  | 'factor'
  | 'denominator'
  | 'count'
  | 'other'

/** Buckets that no detector consults, so nothing in them can excuse a figure. */
const UNMATCHABLE: ReadonlySet<Bucket> = new Set<Bucket>(['count', 'other'])

/**
 * Field name to dimension. Longest suffixes first: `_kgCO2e_m3` must win over
 * `_m3`, and `_usd_m2` over `_usd`.
 */
export function bucketForKey(key: string): Bucket {
  const suffixes: ReadonlyArray<readonly [string, Bucket]> = [
    ['_kgCO2e_m2', 'carbonIntensity'],
    ['_kgCO2e_m3', 'carbonDensity'],
    ['_kg_m3', 'density'],
    ['_kgCO2e', 'mass'],
    ['_usd_m2', 'moneyIntensity'],
    ['_usd_m3', 'moneyDensity'],
    ['_usd', 'money'],
    ['_kNm', 'moment'],
    ['_kN', 'force'],
    ['_kmh', 'speed'],
    ['_ms', 'flowSpeed'],
    ['_MPa', 'stress'],
    ['_GPa', 'stress'],
    ['_m2', 'area'],
    ['_m3', 'volume'],
    ['_m', 'length'],
    // Ground acceleration as a fraction of gravity (Ss, S1, SDS, SD1), and the
    // fundamental period. Both are figures a model will happily invent when
    // asked why an earthquake governs.
    ['_g', 'acceleration'],
    ['_s', 'time'],
  ]
  for (const [suffix, bucket] of suffixes) {
    if (key.endsWith(suffix)) return bucket
  }
  if (key.endsWith('Denominator')) return 'denominator'
  // Safety factors and slenderness are dimensionless but are quoted bare, so
  // they get their own bucket rather than mixing with utilisation ratios.
  if (/factor|slenderness/i.test(key)) return 'factor'
  if (/utilization|ratio/i.test(key)) return 'ratio'
  return 'count'
}

/** Every number in the context, filed under the dimension its name declares. */
export function collectByBucket(
  value: unknown,
  key = '',
  into: Map<Bucket, number[]> = new Map(),
): Map<Bucket, number[]> {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      const bucket = bucketForKey(key)
      const existing = into.get(bucket)
      if (existing) existing.push(value)
      else into.set(bucket, [value])
    }
    return into
  }
  if (Array.isArray(value)) {
    // Array entries inherit the key of the array itself, so `storeys` members
    // are walked by their own field names below.
    for (const entry of value) collectByBucket(entry, key, into)
    return into
  }
  if (typeof value === 'object' && value !== null) {
    for (const [childKey, child] of Object.entries(value)) {
      collectByBucket(child, childKey, into)
    }
  }
  return into
}

interface Detected {
  text: string
  /** Value converted into the bucket's canonical unit. */
  value: number
  bucket: Bucket
  /** Decimal places written, in the unit the model used. */
  decimals: number
  /** Canonical value per written unit, so tolerance can be scaled too. */
  scale: number
  /** For the report: the unit as the model wrote it. */
  unit: string
}

/**
 * Longest alternatives first so "kNm" is not read as "kN", "m/s" is not read as
 * "m", and "kg" is not read as "g". The trailing lookahead stops "5 m" matching
 * inside "5 metres", "1 t" inside "1 time" and "2 s" inside "2 storeys".
 */
const UNIT_PATTERN =
  /(\d[\d,]*(?:\.\d+)?)\s*(kN·m|kN-m|kN\.m|kNm|kN|kgCO2e\/m2|kgCO2e\/m3|kgCO2e|kg\/m3|kg|USD\/m2|USD\/m3|USD|MPa|GPa|km\/h|m\/s|tonnes|tonne|m2|m3|m²|m³|%|t|m|g|s)(?![a-zA-Z0-9])/g

/** Captures the "/m²" that turns a cost into a cost intensity. */
const CURRENCY_PATTERN =
  /\$\s?(\d[\d,]*(?:\.\d+)?)\s*([kKmM])?(\s*\/\s*m[2²])?(?![a-zA-Z0-9])/g

const DRIFT_PATTERN = /\bh\s*\/\s*(\d[\d,]*)/gi

const SAFETY_FACTOR_PATTERN =
  /(?:safety\s+factor|factor\s+of\s+safety|\bFoS\b)[^\d\n]{0,24}?(\d+(?:\.\d+)?)/gi

/** Written unit to (bucket, canonical-units-per-written-unit). */
const UNIT_BUCKETS: Readonly<Record<string, readonly [Bucket, number]>> = {
  'kN·m': ['moment', 1],
  'kN-m': ['moment', 1],
  'kN.m': ['moment', 1],
  kNm: ['moment', 1],
  kN: ['force', 1],
  'kgCO2e/m2': ['carbonIntensity', 1],
  'kgCO2e/m3': ['carbonDensity', 1],
  kgCO2e: ['mass', 1],
  'kg/m3': ['density', 1],
  kg: ['mass', 1],
  'USD/m2': ['moneyIntensity', 1],
  'USD/m3': ['moneyDensity', 1],
  USD: ['money', 1],
  MPa: ['stress', 1],
  GPa: ['stress', 1],
  'km/h': ['speed', 1],
  'm/s': ['flowSpeed', 1],
  tonnes: ['mass', 1000],
  tonne: ['mass', 1000],
  t: ['mass', 1000],
  m2: ['area', 1],
  'm²': ['area', 1],
  m3: ['volume', 1],
  'm³': ['volume', 1],
  m: ['length', 1],
  g: ['acceleration', 1],
  s: ['time', 1],
  '%': ['ratio', 0.01],
}

function parseWritten(raw: string): number {
  return Number(raw.replace(/,/g, ''))
}

function decimalsIn(raw: string): number {
  const dot = raw.indexOf('.')
  return dot === -1 ? 0 : raw.length - dot - 1
}

function detect(text: string): Detected[] {
  const found: Detected[] = []

  for (const match of text.matchAll(UNIT_PATTERN)) {
    const [full, digits = '', unit = ''] = match
    const mapping = UNIT_BUCKETS[unit]
    if (!mapping) continue
    const [bucket, scale] = mapping
    found.push({
      text: full.trim(),
      value: parseWritten(digits) * scale,
      bucket,
      decimals: decimalsIn(digits),
      scale,
      unit,
    })
  }

  for (const match of text.matchAll(CURRENCY_PATTERN)) {
    const [full, digits = '', magnitude, perArea] = match
    const scale = magnitude
      ? magnitude.toLowerCase() === 'k'
        ? 1000
        : 1_000_000
      : 1
    found.push({
      text: full.trim(),
      value: parseWritten(digits) * scale,
      bucket: perArea ? 'moneyIntensity' : 'money',
      decimals: decimalsIn(digits),
      scale,
      unit: perArea ? 'USD/m2' : 'USD',
    })
  }

  for (const match of text.matchAll(DRIFT_PATTERN)) {
    const [full, digits = ''] = match
    found.push({
      text: full.trim(),
      value: parseWritten(digits),
      bucket: 'denominator',
      decimals: 0,
      scale: 1,
      unit: 'drift denominator',
    })
  }

  for (const match of text.matchAll(SAFETY_FACTOR_PATTERN)) {
    const [full, digits = ''] = match
    found.push({
      text: full.trim(),
      value: parseWritten(digits),
      bucket: 'factor',
      decimals: decimalsIn(digits),
      scale: 1,
      unit: 'safety factor',
    })
  }

  return found
}

/**
 * Traceable if a context value in the same dimension rounds to what was
 * written. Tolerance is half a unit in the last written decimal place --
 * quoting 1.42 for 1.4237 is correct rounding, not invention -- widened to
 * 0.5% for large values, where dropping a digit of precision is reasonable.
 */
function isTraceable(figure: Detected, candidates: readonly number[]): boolean {
  const roundingTolerance = 0.5 * 10 ** -figure.decimals * figure.scale
  return candidates.some((candidate) => {
    const tolerance = Math.max(roundingTolerance, Math.abs(candidate) * 0.005)
    return Math.abs(candidate - figure.value) <= tolerance
  })
}

/** Every piece of prose the student will actually read. */
function critiqueText(critique: Critique): string {
  return [
    critique.verdict,
    critique.explanation,
    ...critique.suggestions.flatMap((suggestion) => [
      suggestion.change,
      suggestion.rationale,
      suggestion.tradeoff,
    ]),
  ].join('\n')
}

/**
 * The general form: prose in, plus whatever object holds the figures that prose
 * is allowed to quote, and out come the ones that trace back to nothing.
 *
 * Exported because the critique is not the only place a model writes prose about
 * numbers. `ai/blueprint/parse.ts` runs a proposed design's own explanation
 * through here against the inputs it proposed, so a blueprint that helpfully
 * predicts "a safety factor of about 2" is caught by exactly the same detectors
 * that catch it in a critique — one home for the checking, two callers.
 *
 * `source` is walked for numbers by field name, so it must follow the project's
 * unit-suffix convention; a field without a unit lands in an unmatchable bucket
 * and can excuse nothing. See `bucketForKey`.
 */
export function findUnbackedFigures(
  text: string,
  source: unknown,
): UntraceableFigure[] {
  const byBucket = collectByBucket(source)
  const seen = new Set<string>()
  const untraceable: UntraceableFigure[] = []

  for (const figure of detect(text)) {
    if (!Number.isFinite(figure.value)) continue
    const candidates = UNMATCHABLE.has(figure.bucket)
      ? []
      : (byBucket.get(figure.bucket) ?? [])
    if (isTraceable(figure, candidates)) continue
    // A model that repeats its own invented figure should be reported once.
    const key = `${figure.value}|${figure.bucket}`
    if (seen.has(key)) continue
    seen.add(key)
    untraceable.push({ text: figure.text, value: figure.value, unit: figure.unit })
  }

  return untraceable
}

export function findUntraceableFigures(
  critique: Critique,
  context: CritiqueContext,
): UntraceableFigure[] {
  return findUnbackedFigures(critiqueText(critique), context)
}
