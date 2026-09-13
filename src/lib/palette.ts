/**
 * Utilisation colour bands, shared by the 3D viewport and the HTML panels.
 *
 * Deliberately discrete rather than a continuous ramp: a storey is safe,
 * approaching its limit, or over it. Three states read the same way in a
 * shaded 3D box and in a table cell, so a student comparing the two is never
 * confused about whether a slightly different green means something.
 *
 * `utilization` is dimensionless with 1.0 = at the limit (see
 * engine/types.ts StoreyResult.utilization).
 */

export type UtilizationBand = 'safe' | 'caution' | 'fail'

/** Below this, a storey has meaningful reserve. Above it, it is being worked. */
export const CAUTION_THRESHOLD = 0.7

export function utilizationBand(utilization: number): UtilizationBand {
  // A non-finite utilisation means a zero-capacity denominator upstream —
  // treat it as failure rather than letting it fall through to 'safe'.
  if (!Number.isFinite(utilization) || utilization > 1) return 'fail'
  if (utilization > CAUTION_THRESHOLD) return 'caution'
  return 'safe'
}

/**
 * Hex, because three.js Color cannot parse the oklch() the Tailwind theme
 * would otherwise prefer. These are the source of truth; the `@theme` block
 * in index.css mirrors them and says so.
 */
export const BAND_HEX: Readonly<Record<UtilizationBand, string>> = {
  safe: '#22c55e',
  caution: '#f59e0b',
  fail: '#ef4444',
}

/**
 * The same three states, darkened until they are legible as text on the
 * studio's paper. `BAND_HEX` is tuned for a shaded 3D box against a sky;
 * #f59e0b as 11px type on #fff7ef is not readable, and quietly using it there
 * would make "caution" the hardest word on screen to read.
 *
 * Same three bands, same meanings, one lightness apart — so a table cell and
 * the box it describes still agree. `index.css` mirrors these as
 * `--color-*-ink` for the same reason it mirrors the hexes above.
 */
export const BAND_INK_HEX: Readonly<Record<UtilizationBand, string>> = {
  safe: '#15803d',
  caution: '#b45309',
  fail: '#b91c1c',
}

export const BAND_TEXT_CLASS: Readonly<Record<UtilizationBand, string>> = {
  safe: 'text-safe-ink',
  caution: 'text-caution-ink',
  fail: 'text-fail-ink',
}

export const BAND_LABEL: Readonly<Record<UtilizationBand, string>> = {
  safe: 'Reserve',
  caution: 'Working hard',
  fail: 'Over limit',
}

// Hazard colours used to live here as WIND_HEX. They moved to `lib/hazard.ts`
// when there were three of them, because they are copy about the event rather
// than a reading of the building — and keeping them out of this file is what
// stops a restyle of the storm from being able to change what "over the limit"
// looks like.
