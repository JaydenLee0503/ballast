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

export const BAND_TEXT_CLASS: Readonly<Record<UtilizationBand, string>> = {
  safe: 'text-safe',
  caution: 'text-caution',
  fail: 'text-fail',
}

export const BAND_LABEL: Readonly<Record<UtilizationBand, string>> = {
  safe: 'Reserve',
  caution: 'Working hard',
  fail: 'Over limit',
}

/** Wind arrows. Not a utilisation colour; kept here so the palette is in one file. */
export const WIND_HEX = '#60a5fa'
