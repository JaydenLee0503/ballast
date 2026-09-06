/**
 * Roof solids, as arithmetic.
 *
 * WHY NOT A SCALED PRIMITIVE. The first version of this drew a pitched roof as
 * a four-sided cone scaled to the plan. That is a pyramid, and a pyramid's apex
 * is a *point* — fine on a square plan and plainly wrong on any other, because a
 * real roof of that shape has a ridge *line* running down the long axis. On the
 * townhouse's 7 x 12 m plan it read as a spike. There is no primitive with a
 * ridge, so the vertices are written out here instead.
 *
 * The monopitch has the same lineage of bug. It was a box rotated a few degrees
 * about Z, which tilts the slab but leaves a wedge of open air between the high
 * edge and the wall below it — a roof visibly floating off its building. A solid
 * prism cannot do that: its underside *is* the wall top.
 *
 * Output is a non-indexed triangle soup so `computeVertexNormals` gives one
 * normal per face. Roofs are faceted; smoothing the ridge would round it.
 *
 * Pure, and separated from the component, because the failure mode here is
 * silent: a winding order backwards or a vertex on the wrong side of the plan
 * still renders, just wrongly. Arithmetic that can be wrong without throwing is
 * arithmetic worth testing.
 */

export interface RoofPrism {
  /** Triangle soup: three floats per vertex, three vertices per triangle. */
  readonly positions: readonly number[]
  /**
   * Radians about Y. The solids are built along their local X and turned to
   * face the right way, rather than being written out twice.
   */
  readonly rotationY: number
  /** Height above the wall top, metres. */
  readonly rise_m: number
}

/** Push one triangle. Winding is counter-clockwise seen from outside. */
function tri(
  out: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
): void {
  out.push(...a, ...b, ...c)
}

function quad(
  out: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  d: readonly [number, number, number],
): void {
  tri(out, a, b, c)
  tri(out, a, c, d)
}

/**
 * A gable roof: two slopes meeting at a ridge.
 *
 * The ridge runs down the **longer** plan dimension, which is what a terrace
 * does and the only orientation that does not look like a mistake on a narrow
 * deep plan. Pitch is taken off the *shorter* span, because that is the
 * distance the slope actually has to climb.
 */
export function gablePrism(
  widthX_m: number,
  widthZ_m: number,
  riseRatio: number,
  maxRise_m: number,
): RoofPrism {
  const alongX = widthX_m >= widthZ_m
  const ridgeSpan = alongX ? widthX_m : widthZ_m
  const slopeSpan = alongX ? widthZ_m : widthX_m
  const rise = Math.min(maxRise_m, riseRatio * slopeSpan)

  const a = ridgeSpan / 2
  const b = slopeSpan / 2
  const positions: number[] = []

  // Two slopes, from each long eave up to the ridge.
  quad(positions, [-a, 0, b], [a, 0, b], [a, rise, 0], [-a, rise, 0])
  quad(positions, [a, 0, -b], [-a, 0, -b], [-a, rise, 0], [a, rise, 0])
  // The two gable ends, which are what makes this a ridge and not a point.
  tri(positions, [a, 0, b], [a, 0, -b], [a, rise, 0])
  tri(positions, [-a, 0, -b], [-a, 0, b], [-a, rise, 0])

  return { positions, rotationY: alongX ? 0 : Math.PI / 2, rise_m: rise }
}

/**
 * A monopitch: one slope, low edge on one wall and high edge on the other.
 *
 * A solid wedge, not a tilted plate. The fall is taken across the **shorter**
 * span, which is how a wide shed is actually built — pitching a 56 m warehouse
 * along its length would put its ridge four storeys up.
 */
export function monoPrism(
  widthX_m: number,
  widthZ_m: number,
  fallRatio: number,
  maxFall_m: number,
): RoofPrism {
  const acrossX = widthX_m <= widthZ_m
  const slopeSpan = acrossX ? widthX_m : widthZ_m
  const ridgeSpan = acrossX ? widthZ_m : widthX_m
  const rise = Math.min(maxFall_m, fallRatio * slopeSpan)

  const a = slopeSpan / 2
  const b = ridgeSpan / 2
  const positions: number[] = []

  // The slope, from the low eave at -a up to the high edge at +a.
  tri(positions, [-a, 0, -b], [a, rise, b], [a, rise, -b])
  tri(positions, [-a, 0, -b], [-a, 0, b], [a, rise, b])
  // The tall wall under the high edge.
  quad(positions, [a, 0, b], [a, 0, -b], [a, rise, -b], [a, rise, b])
  // The two triangular flanks.
  tri(positions, [-a, 0, -b], [a, rise, -b], [a, 0, -b])
  tri(positions, [-a, 0, b], [a, 0, b], [a, rise, b])

  return { positions, rotationY: acrossX ? 0 : Math.PI / 2, rise_m: rise }
}
