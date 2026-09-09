/**
 * Turning a model's reply into a design the app can actually hold.
 *
 * This is the boundary where a proposal stops being text. Everything past here
 * is an ordinary `Structure` — the controls edit it, the parser in
 * `persistence/schema.ts` accepts it, and `analyze()` cannot tell it from one a
 * student built by hand. That is only true because of what happens in this file.
 *
 * REJECT WHERE A DEFAULT WOULD BE AN INVENTION; CLAMP WHERE THE CONTROLS WOULD.
 * `persistence/` says "reject, don't repair", and it is right to: a saved design
 * is a *record* of what somebody built, so substituting a material would hand
 * them a carbon number for a building they did not design. A blueprint is not a
 * record of anything — it is a suggested slider position, and the student is
 * looking at the sliders. So:
 *
 *   - An unknown material id, lateral system, facade or foundation is refused
 *     **by name**. There is no honest substitute for "make it out of X", and
 *     quietly building it out of concrete instead is the persistence failure
 *     wearing a different hat.
 *   - A missing or non-numeric dimension is refused too. Clamping an absent
 *     storey count to the minimum would silently produce a one-storey building
 *     nobody asked for.
 *   - A number outside the editing limits is pulled to the edge and the
 *     adjustment is *reported*, because that is exactly what dragging the
 *     slider to its end would have done, and the student can see the result.
 *   - Exposure category and typology fall back when absent, because both
 *     already have a documented honest default: 'C' is the engine's own and the
 *     archetypes' default, and 'custom' is defined as the absence of a claim.
 *     Both fallbacks are reported as adjustments.
 *
 * And the prose is checked. `ai/guard.ts` runs the model's own explanation
 * against the inputs the blueprint proposes, so "this will comfortably exceed a
 * safety factor of 2" comes back flagged rather than read as a result.
 */

import {
  EXPOSURE_CATEGORIES,
  FACADE_SYSTEMS,
  FOUNDATION_TYPES,
  LATERAL_SYSTEMS,
  MATERIAL_LIBRARY,
  PLAN_SHAPES,
  TYPOLOGIES,
  type ExposureCategory,
  type FacadeSystem,
  type FoundationType,
  type LateralSystem,
  type MaterialLibrary,
  type PlanShape,
  type Storey,
  type Typology,
} from '@/engine'
import {
  ANCHOR_CAPACITY_LIMITS_KN,
  clamp,
  EMBEDMENT_DEPTH_LIMITS_M,
  PLAN_WIDTH_LIMITS_M,
  STOREY_COUNT_LIMITS,
  STOREY_HEIGHT_LIMITS_M,
  TAPER_LIMITS,
  withinLimits,
  type Limits,
} from '@/lib/limits.ts'
import { findUnbackedFigures } from '@/ai/guard.ts'
import { extractJsonObject } from '@/ai/parse.ts'
import type { UntraceableFigure } from '@/ai/types.ts'
import { caveatText } from './types.ts'

/** A label in a chip, not a document. Shorter than a saved design's name. */
export const MAX_BLUEPRINT_NAME_LENGTH = 60

/**
 * A validated proposal: the shape control values, in the same terms the store
 * already holds them. Deliberately not a `Structure` — the taper and the
 * uniform storey size are *inputs the widths are generated from*, and the store
 * owns that generation (see `withTaperedPlan`). Handing over a finished
 * `Structure` would mean two places knew how a taper becomes widths.
 */
export interface Blueprint {
  name: string
  typology: Typology
  /**
   * The storeys, ground first, already checked and clamped — the engine's own
   * `Storey`, so `applyBlueprint` has nothing left to convert.
   *
   * A proposal may be one repeated size (the common case) or a stack of
   * differently sized *sections*: a 12 m hall with two 4 m tiers over it is
   * three storeys with two shapes. Both arrive here as a plain list, because
   * that is what `Structure` has always held.
   */
  storeys: Storey[]
  /**
   * Dimensionless, 0 is a plain box. Meaningful only for a proposal whose
   * storeys all share a plan — a taper is a rule about how one size changes with
   * height, and it has nothing to say about a stack that is already two sizes.
   * `applyBlueprint` ignores it in that case.
   */
  taper: number
  foundationType: FoundationType
  embedmentDepth_m: number
  anchorCapacity_kN: number
  exposureCategory: ExposureCategory
  /** The model's own words on what it built. Never a claim about results. */
  interpretation: string
  notes: string
  /**
   * The engine's limits for this request, as finished sentences from
   * `BLUEPRINT_CAVEATS`. The union of what the model cited and what the request
   * obviously implies — see `requiredCaveats`.
   */
  caveats: string[]
  /** What was pulled into range, in the student's language. */
  adjustments: string[]
  /** Figures in the prose that trace back to nothing. Shown as a caution. */
  unverified: UntraceableFigure[]
}

export class BlueprintParseError extends Error {
  override readonly name = 'BlueprintParseError'
}

function fail(message: string): never {
  throw new BlueprintParseError(message)
}

/**
 * Words in the *student's own request* that imply a limit of the engine,
 * whatever the model chose to admit.
 *
 * This is the deterministic floor under the caveats. A model asked for an arena
 * may cite the long-span caveat, or may not; either way the student is looking
 * at a box with no long-span roof, no uplift case and no crowd on the floor, and
 * they have to be told. Matching is on the raw request rather than on the
 * proposal, because the request is the thing that was actually asked for.
 *
 * Deliberately blunt and deliberately over-inclusive: an extra true sentence
 * about what the model does not do costs a line of text, and a missing one
 * costs the student's trust the moment somebody who knows better looks over
 * their shoulder.
 */
export function requiredCaveats(description: string): string[] {
  const text = description.toLowerCase()
  const ids = new Set<string>()
  const hit = (pattern: RegExp): boolean => pattern.test(text)

  if (hit(/\b(bridge|viaduct|mast|pylon|tunnel|dam|jetty|pier|wind turbine)\b/)) {
    ids.add('not-a-building')
  }
  if (
    hit(
      /\b(arena|stadium|stadia|colosseum|coliseum|amphitheat\w*|hangar|dome|velodrome|aircraft|terminal|concourse|sports hall|swimming pool|ice rink|warehouse|barn|shed|marquee|pavilion)\b/,
    )
  ) {
    ids.add('long-span-roof')
    ids.add('uplift')
  }
  if (
    hit(
      /\b(arena|stadium|stadia|colosseum|coliseum|amphitheat\w*|theatre|theater|cinema|concert|church|cathedral|mosque|temple|synagogue|hall|gym\w*|market|station|terminal|museum|atrium|auditorium)\b/,
    )
  ) {
    ids.add('internal-void')
    ids.add('occupancy-load')
  }
  if (hit(/\b(round|circular|cylind\w*|oval|ellip\w*|curv\w*|dome|spiral|twist\w*|courtyard|l-shaped|u-shaped|donut|doughnut|ring)\b/)) {
    ids.add('curved-plan')
  }
  if (hit(/\b(cantilever\w*|overhang\w*|tier\w*|balcon\w*|terrac\w*|stepped|bleacher\w*|grandstand|seating bowl)\b/)) {
    ids.add('cantilever')
  }
  if (hit(/\b(hangar|open[- ]air|open[- ]sided|open ends|roofless|garage|carport|canopy|shelter|market|barn)\b/)) {
    ids.add('openings')
  }

  return [...ids]
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('the model did not reply with a JSON object describing a building')
  }
  return value as Record<string, unknown>
}

function requireMember<T extends string>(
  raw: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof raw !== 'string' || !allowed.includes(raw.trim() as T)) {
    // Named, not substituted. "It asked for carbon-fibre" is a sentence a
    // student can act on; a concrete building they did not ask for is not.
    fail(
      `the model chose "${String(raw)}" for ${field}, which this build does not have. ` +
        `It has: ${allowed.join(', ')}.`,
    )
  }
  return raw.trim() as T
}

/** Optional member: an absent or unrecognised value falls back, and says so. */
function memberOr<T extends string>(
  raw: unknown,
  field: string,
  allowed: readonly T[],
  fallback: T,
  adjustments: string[],
): T {
  if (typeof raw === 'string' && allowed.includes(raw.trim() as T)) {
    return raw.trim() as T
  }
  adjustments.push(
    raw === undefined || raw === null
      ? `No ${field} was proposed, so it is set to ${fallback}.`
      : `"${String(raw)}" is not a ${field} this build has, so it is set to ${fallback}.`,
  )
  return fallback
}

interface NumberSpec {
  field: string
  /** How the adjustment reads, e.g. "floors" or "m". */
  unit: string
  limits: Limits
  /** Rounded to this many decimals, matching what the control can express. */
  decimals: number
}

function requireNumber(
  raw: unknown,
  spec: NumberSpec,
  adjustments: string[],
): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    fail(
      `the model gave ${spec.field} as ${JSON.stringify(raw)}, which is not a number. ` +
        'Nothing sensible can be assumed in its place.',
    )
  }
  const factor = 10 ** spec.decimals
  const rounded = Math.round(raw * factor) / factor
  if (!withinLimits(rounded, spec.limits)) {
    const pulled = clamp(rounded, spec.limits)
    adjustments.push(
      `Asked for ${rounded}${spec.unit === '' ? '' : ` ${spec.unit}`} of ` +
        `${spec.field}; the controls stop at ${pulled}${
          spec.unit === '' ? '' : ` ${spec.unit}`
        }.`,
    )
    return pulled
  }
  return rounded
}

function parseName(raw: unknown, adjustments: string[]): string {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (name === '') return 'Untitled starting point'
  if (name.length > MAX_BLUEPRINT_NAME_LENGTH) {
    adjustments.push('The name was longer than the label can hold, so it is cut short.')
    return name.slice(0, MAX_BLUEPRINT_NAME_LENGTH).trimEnd()
  }
  return name
}

function parseProse(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

/** Caveat ids the model cited, keeping only ones this build has text for. */
function citedCaveats(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => (typeof entry === 'string' ? [entry.trim()] : []))
}

/**
 * The numbers the prose is allowed to restate: the blueprint's own inputs, keyed
 * with their units so the guard files them by dimension. A model may say "60 m
 * across" about a plan it chose; it may not say "1,200 kN of base shear",
 * because nothing here has been analysed yet.
 */
function backingFigures(
  blueprint: Omit<Blueprint, 'caveats' | 'adjustments' | 'unverified'>,
): unknown {
  const { storeys } = blueprint
  return {
    height_m: storeys.map((storey) => storey.height_m),
    totalHeight_m: storeys.reduce((sum, storey) => sum + storey.height_m, 0),
    widthX_m: storeys.map((storey) => storey.widthX_m),
    widthY_m: storeys.map((storey) => storey.widthY_m),
    embedmentDepth_m: blueprint.embedmentDepth_m,
    anchorCapacity_kN: blueprint.anchorCapacity_kN,
    floorArea_m2: storeys.map((storey) => storey.widthX_m * storey.widthY_m),
    // Not unit-suffixed on purpose: a storey count is a count, and the guard
    // must never let one excuse a quantity. See `bucketForKey`.
    storeyCount: storeys.length,
  }
}

/**
 * Expand a `sections` list into storeys, bottom to top.
 *
 * Each section says how many storeys it is and how big they are, and inherits
 * anything it leaves out from `base` — the top-level fields, which the prompt
 * requires whether sections are used or not. So a section can change only the
 * height, and a hall stays the same material as the floors above it unless the
 * model says otherwise.
 *
 * `budget` is what remains of `STOREY_COUNT_LIMITS.max`. A proposal that asks
 * for more storeys than the controls allow is truncated at the top rather than
 * refused: the lower storeys are the loaded ones and the ones the student is
 * being taught about, and the adjustment says what happened.
 */
function expandSections(
  raw: unknown,
  base: Storey,
  library: MaterialLibrary,
  adjustments: string[],
): Storey[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null

  const storeys: Storey[] = []
  let truncated = false

  raw.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      fail(`sections[${index}] is not an object describing a part of the building`)
    }
    const section = entry as Record<string, unknown>
    const count = requireNumber(
      section['count'],
      {
        field: `sections[${index}].count`,
        unit: 'floors',
        limits: { min: 1, max: STOREY_COUNT_LIMITS.max },
        decimals: 0,
      },
      adjustments,
    )

    const materialId = section['materialId']
    if (materialId !== undefined && typeof materialId === 'string') {
      if (!library.has(materialId.trim())) {
        fail(
          `sections[${index}] asks for the material "${materialId}", which is not ` +
            `in the library. It has: ${[...library.keys()].join(', ')}.`,
        )
      }
    }

    const storey: Storey = {
      height_m: requireNumber(
        section['height_m'] ?? base.height_m,
        {
          field: `sections[${index}].height_m`,
          unit: 'm',
          limits: STOREY_HEIGHT_LIMITS_M,
          decimals: 1,
        },
        adjustments,
      ),
      widthX_m: requireNumber(
        section['widthX_m'] ?? base.widthX_m,
        {
          field: `sections[${index}].widthX_m`,
          unit: 'm',
          limits: PLAN_WIDTH_LIMITS_M,
          decimals: 1,
        },
        adjustments,
      ),
      widthY_m: requireNumber(
        section['widthY_m'] ?? base.widthY_m,
        {
          field: `sections[${index}].widthY_m`,
          unit: 'm',
          limits: PLAN_WIDTH_LIMITS_M,
          decimals: 1,
        },
        adjustments,
      ),
      materialId:
        typeof materialId === 'string' ? materialId.trim() : base.materialId,
      lateralSystem:
        section['lateralSystem'] === undefined
          ? base.lateralSystem
          : requireMember<LateralSystem>(
              section['lateralSystem'],
              `sections[${index}].lateralSystem`,
              LATERAL_SYSTEMS,
            ),
      facade:
        section['facade'] === undefined
          ? base.facade
          : requireMember<FacadeSystem>(
              section['facade'],
              `sections[${index}].facade`,
              FACADE_SYSTEMS,
            ),
      planShape:
        section['planShape'] === undefined
          ? base.planShape
          : requireMember<PlanShape>(
              section['planShape'],
              `sections[${index}].planShape`,
              PLAN_SHAPES,
            ),
    }

    for (let i = 0; i < count; i += 1) {
      if (storeys.length >= STOREY_COUNT_LIMITS.max) {
        truncated = true
        return
      }
      storeys.push({ ...storey })
    }
  })

  if (truncated) {
    adjustments.push(
      `The sections added up to more floors than the controls hold, so the stack ` +
        `stops at ${STOREY_COUNT_LIMITS.max}.`,
    )
  }
  return storeys.length === 0 ? null : storeys
}

/**
 * Text in, blueprint out. `description` is the student's own request, and is
 * used for nothing but `requiredCaveats` — no part of the design is inferred
 * from it here, because inference is the model's job and verification is ours.
 */
export function parseBlueprint(
  raw: string,
  description: string,
  library: MaterialLibrary = MATERIAL_LIBRARY,
): Blueprint {
  const candidate = extractJsonObject(raw.trim())
  if (candidate === null) {
    fail('the model replied without any JSON object in it.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch (error) {
    fail(
      `the model's JSON could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  const record = asRecord(parsed)
  const adjustments: string[] = []

  const materialId = record['materialId']
  if (typeof materialId !== 'string' || !library.has(materialId.trim())) {
    fail(
      `the model chose the material "${String(materialId)}", which is not in the ` +
        `library. It has: ${[...library.keys()].join(', ')}.`,
    )
  }

  // The typical storey. Required whether or not `sections` is used, because it is
  // what a section inherits the fields it omits from.
  const base: Storey = {
    height_m: requireNumber(
      record['storeyHeight_m'],
      {
        field: 'storey height',
        unit: 'm',
        limits: STOREY_HEIGHT_LIMITS_M,
        decimals: 1,
      },
      adjustments,
    ),
    widthX_m: requireNumber(
      record['widthX_m'],
      { field: 'width', unit: 'm', limits: PLAN_WIDTH_LIMITS_M, decimals: 1 },
      adjustments,
    ),
    widthY_m: requireNumber(
      record['widthY_m'],
      { field: 'depth', unit: 'm', limits: PLAN_WIDTH_LIMITS_M, decimals: 1 },
      adjustments,
    ),
    materialId: materialId.trim(),
    lateralSystem: requireMember<LateralSystem>(
      record['lateralSystem'],
      'lateral system',
      LATERAL_SYSTEMS,
    ),
    facade: requireMember<FacadeSystem>(record['facade'], 'facade', FACADE_SYSTEMS),
    // Falls back rather than refusing: 'rectangle' is what every design in this
    // app was before footprints existed, and what `persistence/` migrates an old
    // one to. A model that says nothing about the footprint has not chosen an
    // ellipse, so it gets the shape that claims nothing new.
    planShape: memberOr<PlanShape>(
      record['planShape'],
      'plan shape',
      PLAN_SHAPES,
      'rectangle',
      adjustments,
    ),
  }

  const storeyCount = requireNumber(
    record['storeyCount'],
    { field: 'storeyCount', unit: 'floors', limits: STOREY_COUNT_LIMITS, decimals: 0 },
    adjustments,
  )

  const core = {
    name: parseName(record['name'], adjustments),
    typology: memberOr<Typology>(
      record['typology'],
      'building type',
      TYPOLOGIES,
      'custom',
      adjustments,
    ),
    // Sections when the model described differently sized parts, otherwise the
    // typical storey repeated. Either way what comes out is the plain list
    // `Structure` has always held.
    storeys:
      expandSections(record['sections'], base, library, adjustments) ??
      Array.from({ length: storeyCount }, () => ({ ...base })),
    // A missing taper is the one dimension with an honest default: 0 is a plain
    // box, which is what every archetype in the table is.
    taper:
      record['taper'] === undefined
        ? 0
        : requireNumber(
            record['taper'],
            { field: 'taper', unit: '', limits: TAPER_LIMITS, decimals: 2 },
            adjustments,
          ),
    foundationType: requireMember<FoundationType>(
      record['foundationType'],
      'foundation',
      FOUNDATION_TYPES,
    ),
    embedmentDepth_m: requireNumber(
      record['embedmentDepth_m'],
      {
        field: 'embedment depth',
        unit: 'm',
        limits: EMBEDMENT_DEPTH_LIMITS_M,
        decimals: 2,
      },
      adjustments,
    ),
    anchorCapacity_kN: requireNumber(
      record['anchorCapacity_kN'],
      {
        field: 'anchor capacity',
        unit: 'kN',
        limits: ANCHOR_CAPACITY_LIMITS_KN,
        decimals: 0,
      },
      adjustments,
    ),
    exposureCategory: memberOr<ExposureCategory>(
      record['exposureCategory'],
      'exposure category',
      EXPOSURE_CATEGORIES,
      'C',
      adjustments,
    ),
    interpretation: parseProse(record['interpretation']),
    notes: parseProse(record['notes']),
  }

  // The union, not the model's list: what the request implies is true whether
  // or not the model owned up to it.
  const caveatIds = new Set<string>([
    ...citedCaveats(record['caveats']),
    ...requiredCaveats(description),
  ])
  const caveats = [...caveatIds].flatMap((id) => {
    const text = caveatText(id)
    return text === undefined ? [] : [text]
  })

  return {
    ...core,
    caveats,
    adjustments,
    unverified: findUnbackedFigures(
      `${core.interpretation}\n${core.notes}`,
      backingFigures(core),
    ),
  }
}
