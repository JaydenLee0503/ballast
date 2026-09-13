/**
 * The saved-design format, and the parser that decides whether a payload is
 * safe to load.
 *
 * A design arriving here is untrusted. It may have been written by an older
 * version of the app, hand-edited in devtools, pasted from someone else's URL,
 * or (later) read from a Supabase row that another client wrote. The engine
 * has no tolerance for a bad structure — `analyze()` throws — and the whole UI
 * is downstream of one analysis, so an unvalidated load does not corrupt a
 * corner of the app, it replaces the app with an error page.
 *
 * Two rules follow from that:
 *
 * 1. **Parse, don't cast.** `parseDesign` builds a new object field by field
 *    from values it has checked. It never asserts a type onto its input. A
 *    payload with extra properties loses them here rather than carrying them
 *    into React state and back out to storage on the next save.
 * 2. **Reject, don't repair.** A design with an unknown material is refused by
 *    name, not silently swapped for concrete. Quietly substituting would hand
 *    the student a carbon number for a building they did not design, which is
 *    the same failure mode as an invented number — just from a different
 *    direction.
 */

import {
  EXPOSURE_CATEGORIES,
  FACADE_SYSTEMS,
  FOUNDATION_TYPES,
  LATERAL_SYSTEMS,
  PLAN_SHAPES,
  SITE_CLASSES,
  TYPOLOGIES,
  type ExposureCategory,
  type FacadeSystem,
  type FoundationType,
  type LateralSystem,
  type MaterialLibrary,
  type FloodHazard,
  type Hazard,
  type PlanShape,
  type SeismicHazard,
  type SiteClass,
  type Storey,
  type Structure,
  type Typology,
  type WindHazard,
} from '@/engine'
import {
  ANCHOR_CAPACITY_LIMITS_KN,
  EMBEDMENT_DEPTH_LIMITS_M,
  FLOOD_DEPTH_LIMITS_M,
  FLOW_VELOCITY_LIMITS_MS,
  GUST_SPEED_LIMITS_KMH,
  PLAN_WIDTH_LIMITS_M,
  SEISMIC_S1_LIMITS_G,
  SEISMIC_SS_LIMITS_G,
  STOREY_COUNT_LIMITS,
  STOREY_HEIGHT_LIMITS_M,
  withinLimits,
  type Limits,
} from '@/lib/limits.ts'

/**
 * Bump when the shape changes incompatibly.
 *
 * Version 2 added `Storey.facade`. Version 3 added `Structure.typology`.
 * Version 4 added `Storey.planShape`. Version 5 let `hazard` be an earthquake
 * or a flood as well as a wind. Earlier designs are still readable, and the
 * migrations are the whole reason this file can say "reject, don't repair" with
 * a straight face — see `migrateStoreyFacade`, `migrateTypology` and
 * `migratePlanShape` below for why the defaults they pick are the only honest
 * ones.
 *
 * VERSION 5 NEEDS NO MIGRATION, which is the useful thing about it. Every
 * design written by versions 1 through 4 carried `hazard.kind === 'wind'`,
 * because wind was the only hazard that existed; they parse through the wind
 * branch below unchanged and read back with exactly the numbers they were saved
 * with. What the bump buys is the other direction: a version-5 file may contain
 * a seismic or flood hazard, and an older build should refuse it by number
 * rather than fail somewhere deeper.
 */
export const DESIGN_SCHEMA_VERSION = 5

/** Versions this build can read. Anything else is refused by number. */
const READABLE_SCHEMA_VERSIONS: readonly number[] = [1, 2, 3, 4, 5]

/**
 * A version-1 storey has no `facade` field, because version 1 had no concept
 * of an envelope: its carbon, cost and weight were a bare structural frame.
 *
 * So it migrates to `'exposed'`, which is the facade whose carbon, cost and
 * weight are all zero — the design reads back with *exactly* the numbers it
 * was saved with. Any other default would be an invention: picking, say,
 * `'punched'` would hand a student a carbon figure for cladding they never
 * chose, which is the same failure as substituting an unknown material, only
 * quieter. Re-saving stamps version 2, and from then on the choice is theirs.
 */
function migrateStoreyFacade(version: number, raw: unknown): FacadeSystem {
  if (version < 2 && raw === undefined) return 'exposed'
  return requireMember<FacadeSystem>(raw, 'facade', FACADE_SYSTEMS)
}

/**
 * A design saved before version 3 declared no building kind, so it migrates to
 * `'custom'` — which claims nothing.
 *
 * The alternative, guessing an archetype from the geometry, would be an
 * invention of exactly the kind `migrateStoreyFacade` refuses: an eight-storey
 * block is not necessarily an "apartment block", and stamping one would put a
 * label on a student's work that they never chose and cannot see is wrong.
 * `'custom'` also draws the flat roof these designs have always had, so an old
 * design reloads looking exactly as it was saved.
 */
function migrateTypology(version: number, raw: unknown): Typology {
  if (version < 3 && raw === undefined) return 'custom'
  return requireMember<Typology>(raw, 'structure.typology', TYPOLOGIES)
}

/**
 * A design saved before version 4 had no footprint, because every plan in the
 * engine was a rectangle: its floor area, its envelope, the face the wind hit
 * and the section it bent over were all computed rectangularly.
 *
 * So it migrates to `'rectangle'`, and reads back with *exactly* the numbers it
 * was saved with — the same test `migrateStoreyFacade` has to pass. Defaulting
 * to an ellipse would rewrite a saved design's carbon, its wind load and its
 * safety factor at once, for a shape the student never chose.
 */
function migratePlanShape(version: number, raw: unknown): PlanShape {
  if (version < 4 && raw === undefined) return 'rectangle'
  return requireMember<PlanShape>(raw, 'planShape', PLAN_SHAPES)
}

/** How long a design name may be. It is a label in a list, not a document. */
export const MAX_NAME_LENGTH = 80

export interface SavedDesign {
  schemaVersion: number
  name: string
  /** ISO-8601. Display and ordering only; never an input to a calculation. */
  savedAt: string
  structure: Structure
  hazard: Hazard
}

export class DesignParseError extends Error {
  override readonly name = 'DesignParseError'
}

function fail(message: string): never {
  throw new DesignParseError(message)
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireBounded(value: unknown, path: string, limits: Limits): number {
  if (typeof value !== 'number' || !withinLimits(value, limits)) {
    fail(
      `${path} must be a number between ${limits.min} and ${limits.max}, got ${String(value)}`,
    )
  }
  return value
}

function requireMember<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(`${path} must be one of ${allowed.join(', ')}, got ${String(value)}`)
  }
  return value as T
}

function parseName(value: unknown): string {
  if (typeof value !== 'string') fail('name must be a string')
  const name = value.trim()
  if (name.length === 0) fail('name must not be blank')
  if (name.length > MAX_NAME_LENGTH) {
    fail(`name must be at most ${MAX_NAME_LENGTH} characters`)
  }
  return name
}

function parseSavedAt(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    fail(`savedAt must be an ISO-8601 date string, got ${String(value)}`)
  }
  return value
}

function parseStorey(
  value: unknown,
  index: number,
  library: MaterialLibrary,
  version: number,
): Storey {
  const raw = requireObject(value, `storeys[${index}]`)
  const materialId = raw['materialId']
  if (typeof materialId !== 'string' || !library.has(materialId)) {
    // Named rather than substituted: see "reject, don't repair" above. This is
    // the realistic breakage — a design outlives the library entry it used.
    fail(
      `storeys[${index}].materialId "${String(materialId)}" is not in the material library`,
    )
  }
  return {
    height_m: requireBounded(
      raw['height_m'],
      `storeys[${index}].height_m`,
      STOREY_HEIGHT_LIMITS_M,
    ),
    widthX_m: requireBounded(
      raw['widthX_m'],
      `storeys[${index}].widthX_m`,
      PLAN_WIDTH_LIMITS_M,
    ),
    widthY_m: requireBounded(
      raw['widthY_m'],
      `storeys[${index}].widthY_m`,
      PLAN_WIDTH_LIMITS_M,
    ),
    materialId,
    lateralSystem: requireMember<LateralSystem>(
      raw['lateralSystem'],
      `storeys[${index}].lateralSystem`,
      LATERAL_SYSTEMS,
    ),
    facade: migrateStoreyFacade(version, raw['facade']),
    planShape: migratePlanShape(version, raw['planShape']),
  }
}

function parseStructure(
  value: unknown,
  library: MaterialLibrary,
  version: number,
): Structure {
  const raw = requireObject(value, 'structure')
  const storeys = raw['storeys']
  if (!Array.isArray(storeys)) fail('structure.storeys must be an array')
  if (!withinLimits(storeys.length, STOREY_COUNT_LIMITS)) {
    fail(
      `structure.storeys must hold between ${STOREY_COUNT_LIMITS.min} and ` +
        `${STOREY_COUNT_LIMITS.max} storeys, got ${storeys.length}`,
    )
  }
  const foundation = requireObject(raw['foundation'], 'structure.foundation')
  return {
    typology: migrateTypology(version, raw['typology']),
    storeys: storeys.map((storey, index) =>
      parseStorey(storey, index, library, version),
    ),
    foundation: {
      type: requireMember<FoundationType>(
        foundation['type'],
        'structure.foundation.type',
        FOUNDATION_TYPES,
      ),
      embedmentDepth_m: requireBounded(
        foundation['embedmentDepth_m'],
        'structure.foundation.embedmentDepth_m',
        EMBEDMENT_DEPTH_LIMITS_M,
      ),
      anchorCapacity_kN: requireBounded(
        foundation['anchorCapacity_kN'],
        'structure.foundation.anchorCapacity_kN',
        ANCHOR_CAPACITY_LIMITS_KN,
      ),
    },
    exposureCategory: requireMember<ExposureCategory>(
      raw['exposureCategory'],
      'structure.exposureCategory',
      EXPOSURE_CATEGORIES,
    ),
  }
}

/**
 * A bearing, wrapped rather than rejected: a bearing is periodic, so 370 is a
 * legible way of writing 10 rather than a corrupt value. Matches the store's
 * `setDirection`, which is the point — one rule, two readers.
 */
function parseDirection(raw: Record<string, unknown>): number {
  const direction = raw['directionDeg']
  if (typeof direction !== 'number' || !Number.isFinite(direction)) {
    fail(`hazard.directionDeg must be a finite number, got ${String(direction)}`)
  }
  return ((direction % 360) + 360) % 360
}

function parseWindHazard(raw: Record<string, unknown>): WindHazard {
  const roughness = raw['terrainRoughness']
  if (typeof roughness !== 'number' || !Number.isFinite(roughness) || roughness <= 0) {
    fail(`hazard.terrainRoughness must be a positive number, got ${String(roughness)}`)
  }
  return {
    kind: 'wind',
    gustSpeed_kmh: requireBounded(
      raw['gustSpeed_kmh'],
      'hazard.gustSpeed_kmh',
      GUST_SPEED_LIMITS_KMH,
    ),
    directionDeg: parseDirection(raw),
    terrainRoughness: roughness,
  }
}

function parseSeismicHazard(raw: Record<string, unknown>): SeismicHazard {
  return {
    kind: 'seismic',
    Ss_g: requireBounded(raw['Ss_g'], 'hazard.Ss_g', SEISMIC_SS_LIMITS_G),
    S1_g: requireBounded(raw['S1_g'], 'hazard.S1_g', SEISMIC_S1_LIMITS_G),
    // Refused by name, not defaulted to a stiff site. Substituting a site class
    // would rewrite the ground motion the design was checked against, which is
    // the same failure as substituting an unknown material.
    siteClass: requireMember<SiteClass>(
      raw['siteClass'],
      'hazard.siteClass',
      SITE_CLASSES,
    ),
    directionDeg: parseDirection(raw),
  }
}

function parseFloodHazard(raw: Record<string, unknown>): FloodHazard {
  return {
    kind: 'flood',
    depth_m: requireBounded(raw['depth_m'], 'hazard.depth_m', FLOOD_DEPTH_LIMITS_M),
    velocity_ms: requireBounded(
      raw['velocity_ms'],
      'hazard.velocity_ms',
      FLOW_VELOCITY_LIMITS_MS,
    ),
    directionDeg: parseDirection(raw),
  }
}

/**
 * Parse, don't cast, applied to a discriminated union: the `kind` is checked
 * first and then only the fields that kind actually has are read. A payload
 * that claims to be a flood and also carries a gust speed loses the gust speed
 * here rather than carrying it into the store.
 */
function parseHazard(value: unknown): Hazard {
  const raw = requireObject(value, 'hazard')
  switch (raw['kind']) {
    case 'wind':
      return parseWindHazard(raw)
    case 'seismic':
      return parseSeismicHazard(raw)
    case 'flood':
      return parseFloodHazard(raw)
    default:
      // Wildfire was always the next candidate; until it exists, a payload
      // claiming it is from a future version, not this one.
      fail(
        `hazard.kind "${String(raw['kind'])}" is not a hazard this build can analyse`,
      )
  }
}

/** Stamp a design for saving. The clock is a parameter so this stays pure. */
export function createSavedDesign(
  name: string,
  structure: Structure,
  hazard: Hazard,
  savedAt: Date,
): SavedDesign {
  return {
    schemaVersion: DESIGN_SCHEMA_VERSION,
    name: parseName(name),
    savedAt: savedAt.toISOString(),
    structure,
    hazard,
  }
}

/** "1, 2 and 3" — a readable list once there are more than two versions. */
function listVersions(versions: readonly number[]): string {
  if (versions.length <= 1) return versions.join('')
  return `${versions.slice(0, -1).join(', ')} and ${versions[versions.length - 1]}`
}

export function parseDesign(raw: unknown, library: MaterialLibrary): SavedDesign {
  const value = requireObject(raw, 'design')
  const version = value['schemaVersion']
  if (typeof version !== 'number' || !READABLE_SCHEMA_VERSIONS.includes(version)) {
    fail(
      `unsupported schemaVersion ${String(version)}; this build reads ` +
        `${listVersions(READABLE_SCHEMA_VERSIONS)}`,
    )
  }
  // Stamped as current, not as found: what comes out of here has been through
  // every migration, so it *is* a current design whatever it arrived as.
  return {
    schemaVersion: DESIGN_SCHEMA_VERSION,
    name: parseName(value['name']),
    savedAt: parseSavedAt(value['savedAt']),
    structure: parseStructure(value['structure'], library, version),
    hazard: parseHazard(value['hazard']),
  }
}

export function serializeDesign(design: SavedDesign): string {
  return JSON.stringify(design)
}

/** JSON text in, validated design out. Malformed JSON fails like bad data. */
export function parseDesignJson(json: string, library: MaterialLibrary): SavedDesign {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (error) {
    fail(`not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return parseDesign(raw, library)
}
