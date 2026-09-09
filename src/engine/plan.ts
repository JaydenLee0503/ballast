/**
 * Plan geometry, in one place, for every footprint the engine supports.
 *
 * A `Storey` states a `planShape`, and that answers five separate questions
 * that used to be answered by one hard-coded rectangle:
 *
 *   1. how much floor and how much material a storey holds  (`planArea_m2`)
 *   2. how much envelope wraps it                           (`planPerimeter_m`)
 *   3. what silhouette the wind sees at a bearing           (`projectPlan`)
 *   4. what section it bends over                           (`sectionModulus_m3`)
 *   5. how readily it sheds wind                            (`wind.ts`, Cf)
 *
 * They live together because they have to agree. An ellipse that took pi/4 of
 * the area but kept a rectangular perimeter would be a building whose envelope
 * did not fit it, and the error would show up as a carbon figure rather than as
 * anything visible.
 *
 * CONVENTION. `widthX_m` and `widthY_m` are the full plan dimensions in both
 * cases: for an ellipse they are its axes, i.e. the box it is inscribed in.
 * So the same two sliders describe both shapes, switching between them is a
 * shape change and not a size change, and every existing limit still applies.
 */

import type { PlanShape, Storey } from './types.ts'

/**
 * Enclosed plan area.
 *
 *   rectangle:  X * Y
 *   ellipse:    pi/4 * X * Y   (semi-axes X/2 and Y/2, area = pi*a*b)
 *
 * About 78.5% of the rectangle that contains it, which is why a round building
 * of the same footprint is lighter, cheaper and lower-carbon — and, through
 * `drift.ts`, less stiff.
 */
export function planArea_m2(storey: Storey): number {
  return storey.planShape === 'ellipse'
    ? (Math.PI / 4) * storey.widthX_m * storey.widthY_m
    : storey.widthX_m * storey.widthY_m
}

/**
 * Perimeter, which is the envelope's width before it is multiplied by a height.
 *
 *   rectangle:  2 (X + Y)
 *   ellipse:    Ramanujan's second approximation,
 *                 pi (a + b) [ 1 + 3h / (10 + sqrt(4 - 3h)) ],
 *                 h = ((a - b) / (a + b))^2
 *
 * An ellipse has no closed-form perimeter — it is an elliptic integral — so an
 * approximation is unavoidable, and which one is not quite a free choice.
 * Measured against a numerically integrated ellipse, over the aspect ratios
 * `PLAN_WIDTH_LIMITS_M` actually allows:
 *
 *              3:1 plan     15:1 plan (the extreme)
 *   first      3.4e-5       1.4e-3
 *   second     3.3e-8       3.1e-5
 *
 * Both are far inside the precision of anything downstream — the facade rates
 * this multiplies are assembly archetypes where 10% is noise — so this is not a
 * correctness argument, it is a "the better one is one extra line" argument.
 * `plan.test.ts` pins both figures against the integral rather than trusting
 * either the algebra or this comment.
 */
export function planPerimeter_m(storey: Storey): number {
  if (storey.planShape !== 'ellipse') {
    return 2 * (storey.widthX_m + storey.widthY_m)
  }
  const a = storey.widthX_m / 2
  const b = storey.widthY_m / 2
  const sum = a + b
  if (sum === 0) return 0
  const h = ((a - b) / sum) ** 2
  return Math.PI * sum * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)))
}

export interface PlanProjection {
  /** Plan dimension perpendicular to the wind: the face it pushes on. */
  acrossWindWidth_m: number
  /** Plan dimension parallel to the wind: the lever arm for overturning. */
  alongWindDepth_m: number
}

/**
 * The plan as the wind sees it, for a bearing in degrees.
 *
 *   rectangle:  X |sin t| + Y |cos t|, the width of the bounding box of a
 *               rotated rectangle. Conservative for a diagonal wind, which is
 *               the direction a rectangular building is worst in anyway.
 *   ellipse:    2 sqrt( a^2 sin^2 t + b^2 cos^2 t ), which is exact — the
 *               silhouette of an ellipse is another ellipse's axis.
 *
 * Both agree with the old rectangle-only code at 0 and 90 degrees, and both
 * return the full plan dimension there, which is what makes switching shape a
 * change of behaviour rather than a change of size.
 */
export function projectPlan(
  widthX_m: number,
  widthY_m: number,
  directionDeg: number,
  planShape: PlanShape,
): PlanProjection {
  const theta = (directionDeg * Math.PI) / 180
  const s = Math.abs(Math.sin(theta))
  const c = Math.abs(Math.cos(theta))
  if (planShape === 'ellipse') {
    const a = widthX_m / 2
    const b = widthY_m / 2
    return {
      acrossWindWidth_m: 2 * Math.sqrt(a * a * s * s + b * b * c * c),
      alongWindDepth_m: 2 * Math.sqrt(a * a * c * c + b * b * s * s),
    }
  }
  return {
    acrossWindWidth_m: widthX_m * s + widthY_m * c,
    alongWindDepth_m: widthX_m * c + widthY_m * s,
  }
}

/**
 * Gross elastic section modulus of the plan, bending about the across-wind axis.
 *
 *   rectangle:  B L^2 / 6
 *   ellipse:    pi B L^2 / 32
 *
 * where B is the across-wind width and L the along-wind depth. The elliptical
 * form is I/c with I = pi B L^3 / 64 and c = L/2. It is 6*pi/32 = 0.589 of the
 * rectangle's, because an ellipse has less of its plan out at the extreme fibre
 * — the same reason it has less area.
 *
 * Both smear the structural material uniformly across the plan; see
 * `effectiveSectionModulus_m3` in stability.ts, which applies the structural
 * fraction to whichever of these applies and carries the note about how
 * conservative that is.
 */
export function grossSectionModulus_m3(
  acrossWindWidth_m: number,
  alongWindDepth_m: number,
  planShape: PlanShape,
): number {
  const rectangular =
    (acrossWindWidth_m * alongWindDepth_m * alongWindDepth_m) / 6
  return planShape === 'ellipse' ? rectangular * ((6 * Math.PI) / 32) : rectangular
}
