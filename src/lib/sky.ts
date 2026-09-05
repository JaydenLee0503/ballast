/**
 * The sky, as a function of how tall the building is.
 *
 * The studio is a diorama: a city block you are building on, with the rest of
 * the city around it. As the tower climbs, the light goes round — midday, then
 * afternoon, golden hour, dusk, and finally night with the neighbourhood's
 * windows lit. It is scenery, and it is honest about being scenery: nothing
 * here reads an `AnalysisResult`, and nothing here feeds one. The only input
 * is total height in metres, which is a property of the *structure* a student
 * built, not a number the engine derived from it.
 *
 * The module is pure and three-free — colours are plain 0xRRGGBB integers —
 * so the whole atmosphere is a table plus a lerp, and the claim the scenery
 * makes ("taller means darker") is a property a test can assert rather than
 * something you have to squint at.
 */

/** Below this the sky is flat midday; the tower is still a shed. */
export const DAYLIGHT_CEILING_M = 12
/** At and above this it is fully night. ~24 storeys at 3.5 m gets there. */
export const NIGHTFALL_HEIGHT_M = 96

/**
 * Height -> darkness, 0 = midday, 1 = night.
 *
 * Smoothstep rather than linear so the first storey and the last one both
 * change the sky gently; a linear ramp makes the middle of the range feel
 * like a light switch being flicked one storey at a time.
 */
export function nightProgress(totalHeight_m: number): number {
  if (!Number.isFinite(totalHeight_m)) return 0
  const span = NIGHTFALL_HEIGHT_M - DAYLIGHT_CEILING_M
  const raw = (totalHeight_m - DAYLIGHT_CEILING_M) / span
  const u = Math.min(1, Math.max(0, raw))
  return u * u * (3 - 2 * u)
}

/** Everything the scene needs to paint one moment of the day. */
export interface SkyPalette {
  /** Dome colour straight overhead. */
  readonly zenith: number
  /** Dome colour at the horizon; also the fog colour, so the city fades into it. */
  readonly horizon: number
  /** Sun or moon disc, and the colour of the one shadow-casting light. */
  readonly key: number
  readonly keyIntensity: number
  readonly hemisphereSky: number
  readonly hemisphereGround: number
  readonly hemisphereIntensity: number
  readonly ambientIntensity: number
  /** 0..1, faded into the star field. */
  readonly starOpacity: number
  /** 0..1, how brightly the neighbourhood's windows burn. */
  readonly windowGlow: number
}

interface Keyframe extends SkyPalette {
  readonly at: number
}

/**
 * Five moments, interpolated. The horizon warms through golden hour while the
 * zenith only ever darkens, which is what makes a sunset look like a sunset
 * rather than like someone turning the brightness down.
 */
const KEYFRAMES: readonly Keyframe[] = [
  {
    at: 0,
    zenith: 0x2f74d0,
    horizon: 0xbfe1f5,
    key: 0xfff6e2,
    keyIntensity: 2.6,
    hemisphereSky: 0xd8ecff,
    hemisphereGround: 0x6f7f56,
    hemisphereIntensity: 0.95,
    ambientIntensity: 0.45,
    starOpacity: 0,
    windowGlow: 0,
  },
  {
    at: 0.38,
    zenith: 0x2a63c4,
    horizon: 0xf0dcbc,
    key: 0xffe9bd,
    keyIntensity: 2.25,
    hemisphereSky: 0xcfe2ff,
    hemisphereGround: 0x6a7752,
    hemisphereIntensity: 0.85,
    ambientIntensity: 0.4,
    starOpacity: 0,
    windowGlow: 0.06,
  },
  {
    at: 0.62,
    zenith: 0x2b4a92,
    horizon: 0xf6a765,
    key: 0xffb877,
    keyIntensity: 1.85,
    hemisphereSky: 0xa9bcf0,
    hemisphereGround: 0x5d6247,
    hemisphereIntensity: 0.7,
    ambientIntensity: 0.34,
    starOpacity: 0.05,
    windowGlow: 0.35,
  },
  {
    at: 0.82,
    zenith: 0x1a2a63,
    horizon: 0xc4638f,
    key: 0xff8f6a,
    keyIntensity: 1,
    hemisphereSky: 0x6d76b8,
    hemisphereGround: 0x3c3f36,
    hemisphereIntensity: 0.5,
    ambientIntensity: 0.26,
    starOpacity: 0.45,
    windowGlow: 0.75,
  },
  {
    at: 1,
    zenith: 0x050a1e,
    horizon: 0x16305e,
    key: 0xcdd8ff,
    keyIntensity: 0.35,
    hemisphereSky: 0x2a3566,
    hemisphereGround: 0x14161f,
    hemisphereIntensity: 0.35,
    ambientIntensity: 0.16,
    starOpacity: 1,
    windowGlow: 1,
  },
]

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u
}

/**
 * Channel-wise interpolation in sRGB. Not physically correct — a linear-light
 * blend would be — but it is what every gradient tool does, and matching the
 * eye's expectation matters more than matching the photon's for a backdrop.
 */
function lerpHex(a: number, b: number, u: number): number {
  const r = Math.round(lerp((a >> 16) & 0xff, (b >> 16) & 0xff, u))
  const g = Math.round(lerp((a >> 8) & 0xff, (b >> 8) & 0xff, u))
  const bl = Math.round(lerp(a & 0xff, b & 0xff, u))
  return (r << 16) | (g << 8) | bl
}

function blend(a: Keyframe, b: Keyframe, u: number): SkyPalette {
  return {
    zenith: lerpHex(a.zenith, b.zenith, u),
    horizon: lerpHex(a.horizon, b.horizon, u),
    key: lerpHex(a.key, b.key, u),
    keyIntensity: lerp(a.keyIntensity, b.keyIntensity, u),
    hemisphereSky: lerpHex(a.hemisphereSky, b.hemisphereSky, u),
    hemisphereGround: lerpHex(a.hemisphereGround, b.hemisphereGround, u),
    hemisphereIntensity: lerp(a.hemisphereIntensity, b.hemisphereIntensity, u),
    ambientIntensity: lerp(a.ambientIntensity, b.ambientIntensity, u),
    starOpacity: lerp(a.starOpacity, b.starOpacity, u),
    windowGlow: lerp(a.windowGlow, b.windowGlow, u),
  }
}

/** `t` is `nightProgress()`; anything outside 0..1 is clamped to an endpoint. */
export function skyPalette(t: number): SkyPalette {
  const first = KEYFRAMES[0]
  const last = KEYFRAMES[KEYFRAMES.length - 1]
  // Unreachable with a non-empty table, but `noUncheckedIndexedAccess` is on
  // and asserting past it would be exactly the cast this codebase avoids.
  if (!first || !last) throw new Error('sky: empty keyframe table')
  if (!Number.isFinite(t) || t <= 0) return blend(first, first, 0)
  if (t >= 1) return blend(last, last, 0)

  for (let i = 1; i < KEYFRAMES.length; i += 1) {
    const a = KEYFRAMES[i - 1]
    const b = KEYFRAMES[i]
    if (!a || !b) break
    if (t <= b.at) return blend(a, b, (t - a.at) / (b.at - a.at))
  }
  return blend(last, last, 0)
}

/**
 * Rec. 709 relative luminance of a 0xRRGGBB colour, 0..1.
 *
 * Exported because it is how the "the sky gets darker" claim is stated in
 * `sky.test.ts`. Not used by the scene.
 */
export function relativeLuminance(hex: number): number {
  const r = ((hex >> 16) & 0xff) / 255
  const g = ((hex >> 8) & 0xff) / 255
  const b = (hex & 0xff) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The two dome colours together, as one number a test can compare. */
export function skyBrightness(palette: SkyPalette): number {
  return (relativeLuminance(palette.zenith) + relativeLuminance(palette.horizon)) / 2
}

/**
 * Where the key light comes from.
 *
 * The bearing is fixed — it was the original hard-coded light direction, and
 * moving it would swing the building's shadow across the plot as storeys are
 * added, which reads as the *site* changing rather than the time of day. Only
 * the elevation moves: the sun sinks toward the horizon as the day burns down,
 * and the moon that replaces it keeps the same low angle, so the long shadows
 * of dusk carry into night instead of snapping back to overhead.
 */
export const SUN_AZIMUTH_RAD = Math.atan2(38, 26)
const SUN_ELEVATION_HIGH_RAD = (54 * Math.PI) / 180
const SUN_ELEVATION_LOW_RAD = (8 * Math.PI) / 180
/** The sun has finished setting here; past this only colour changes. */
const SUNSET_PROGRESS = 0.85

export interface SunDirection {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** Unit vector from the origin toward the sun (or moon). `t` is `nightProgress()`. */
export function sunDirection(t: number): SunDirection {
  const u = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0) / SUNSET_PROGRESS)
  const elevation = lerp(SUN_ELEVATION_HIGH_RAD, SUN_ELEVATION_LOW_RAD, u)
  const horizontal = Math.cos(elevation)
  return {
    x: horizontal * Math.sin(SUN_AZIMUTH_RAD),
    y: Math.sin(elevation),
    z: horizontal * Math.cos(SUN_AZIMUTH_RAD),
  }
}
