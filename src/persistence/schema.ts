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
  TYPOLOGIES,
  type ExposureCategory,
  type FacadeSystem,
  type FoundationType,
  type LateralSystem,
  type MaterialLibrary,
  type Storey,
  type Structure,
  type Typology,
  type WindHazard,
} from '@/engine'
import {
  ANCHOR_CAPACITY_LIMITS_KN,
  EMBEDMENT_DEPTH_LIMITS_M,
  GUST_SPEED_LIMITS_KMH,
  PLAN_WIDTH_LIMITS_M,
  STOREY_COUNT_LIMITS,
  STOREY_HEIGHT_LIMITS_M,
  withinLimits,
  type Limits,
} from '@/lib/limits.ts'

/**
 * Bump when the shape changes incompatibly.
 *
 * Version 2 added `Storey.facade`. Version 3 added `Structure.typology`.
 * Earlier designs are still readable, and the migrations are the whole reason
 * this file can say "reject, don't repair" with a straight face — see
 * `migrateStoreyFacade` and `migrateTypology` below for why the defaults they
 * pick are the only honest ones.
 */
export const DESIGN_SCHEMA_VERSION = 3

/** Versions this build can read. Anything else is refused by number. */
const READABLE_SCHEMA_VERSIONS: readonly number[] = [1, 2, 3]

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

/** How long a design name may be. It is a label in a list, not a document. */
export const MAX_NAME_LENGTH = 80

export interface SavedDesign {
  schemaVersion: number
  name: string
  /** ISO-8601. Display and ordering only; never an input to a calculation. */
  savedAt: string
  structure: Structure
  hazard: WindHazard
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

function parseHazard(value: unknown): WindHazard {
  const raw = requireObject(value, 'hazard')
  if (raw['kind'] !== 'wind') {
    // Seismic, flood and wildfire join the union later. Until they exist,
    // a payload claiming one of them is from a future version, not this one.
    fail(`hazard.kind "${String(raw['kind'])}" is not a hazard this build can analyse`)
  }
  const direction = raw['directionDeg']
  if (typeof direction !== 'number' || !Number.isFinite(direction)) {
    fail(`hazard.directionDeg must be a finite number, got ${String(direction)}`)
  }
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
    // Wrapped, not rejected: a bearing is periodic, so 370 is a legible way of
    // writing 10 rather than a corrupt value. Matches the store's setDirection.
    directionDeg: ((direction % 360) + 360) % 360,
    terrainRoughness: roughness,
  }
}

/** Stamp a design for saving. The clock is a parameter so this stays pure. */
export function createSavedDesign(
  name: string,
  structure: Structure,
  hazard: WindHazard,
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
