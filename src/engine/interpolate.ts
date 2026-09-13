/**
 * Linear interpolation on a monotonically increasing x-table, clamped at both
 * ends.
 *
 * Shared because three separate code tables in this engine are discretisations
 * of a continuous relationship and all three need the same treatment: Kz
 * against height, Fa and Fv against mapped acceleration, and Cd against the
 * width-to-depth ratio of a flooded face.
 *
 * CLAMPING IS THE POINT, not a convenience. ASCE 7 does not tabulate Kz below
 * 15 ft and does not tabulate Fa above Ss = 1.5; holding the end value is what
 * the standard's own notes say to do, and is in any case better than
 * extrapolating a fitted curve past the data it was fitted to.
 */

export function interpolate(
  xs: readonly number[],
  ys: readonly number[],
  x: number,
): number {
  const first = xs[0]
  const firstY = ys[0]
  const lastIndex = xs.length - 1
  const last = xs[lastIndex]
  const lastY = ys[lastIndex]
  if (
    first === undefined ||
    firstY === undefined ||
    last === undefined ||
    lastY === undefined
  ) {
    throw new Error('interpolate: empty table')
  }
  if (x <= first) return firstY
  if (x >= last) return lastY
  for (let i = 0; i < lastIndex; i += 1) {
    const x0 = xs[i]
    const x1 = xs[i + 1]
    const y0 = ys[i]
    const y1 = ys[i + 1]
    if (
      x0 === undefined ||
      x1 === undefined ||
      y0 === undefined ||
      y1 === undefined
    ) {
      throw new Error('interpolate: ragged table')
    }
    if (x >= x0 && x <= x1) {
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0)
      return y0 + t * (y1 - y0)
    }
  }
  return lastY
}

/** Split a table of `[x, y]` pairs into the two arrays `interpolate` wants. */
export function interpolatePairs(
  table: ReadonlyArray<readonly [number, number]>,
  x: number,
): number {
  return interpolate(
    table.map(([key]) => key),
    table.map(([, value]) => value),
    x,
  )
}
