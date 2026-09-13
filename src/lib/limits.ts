/**
 * Editing limits: the bounds a design must satisfy to be editable in the UI.
 *
 * These bound the controls, not the engine — `analyze()` will happily evaluate
 * a 40-storey rammed-earth tower and warn about it. They exist so a slider
 * cannot produce input that fails validation, which keeps the viewport from
 * ever having nothing to draw.
 *
 * They live here, rather than in the store, because a *loaded* design has to
 * satisfy exactly the same bounds as a *built* one. If `persistence/` used its
 * own numbers, a saved file could restore a state the sliders can no longer
 * express: 40 storeys on a control that stops at 24, with no way back. One set
 * of numbers, two readers.
 */

export interface Limits {
  readonly min: number
  readonly max: number
}

export const STOREY_COUNT_LIMITS: Limits = { min: 1, max: 24 }

/**
 * How far the plan may shrink from the ground storey to the top one, as a
 * fraction. 0 is a prismatic block; 0.6 means the top storey is 40% of the
 * base width.
 *
 * Unlike the others this one bounds no field of `Structure` — a taper is a way
 * of *generating* per-storey widths, and what gets stored is the widths. It
 * lives here anyway because it is an editing bound and this is where those
 * are, and because the widths it generates must land inside
 * `PLAN_WIDTH_LIMITS_M` for the parser to accept the result.
 */
export const TAPER_LIMITS: Limits = { min: 0, max: 0.6 }
export const PLAN_WIDTH_LIMITS_M: Limits = { min: 4, max: 60 }
export const GUST_SPEED_LIMITS_KMH: Limits = { min: 0, max: 300 }

/**
 * Mapped MCE_R spectral accelerations, in g.
 *
 * The upper ends are roughly the worst the ASCE 7-16 maps show anywhere in the
 * contiguous United States: about 2.5 g at short period and 1.2 g at one
 * second, near the San Andreas and in the New Madrid zone. A student who pushes
 * the slider to the end is standing on the worst ground the standard maps, not
 * on an invented one.
 *
 * Zero is included for the same reason a 0 km/h gust is: "what does this
 * building do with no hazard on it at all" is a question worth being able to
 * ask, and the engine answers it without dividing by anything.
 */
export const SEISMIC_SS_LIMITS_G: Limits = { min: 0, max: 2.5 }
export const SEISMIC_S1_LIMITS_G: Limits = { min: 0, max: 1.2 }

/**
 * Flood depth and flow velocity.
 *
 * 12 m is deeper than almost any riverine flood on record and taller than most
 * of what this app builds, which is deliberate: the interesting part of the
 * slider is the first three metres, and the far end is there so a student can
 * see what total submersion does. 6 m/s is a fast river in flood; past about
 * 3 m/s the engine warns that debris impact — which it does not model — starts
 * to dominate.
 */
export const FLOOD_DEPTH_LIMITS_M: Limits = { min: 0, max: 12 }
export const FLOW_VELOCITY_LIMITS_MS: Limits = { min: 0, max: 6 }
export const ANCHOR_CAPACITY_LIMITS_KN: Limits = { min: 0, max: 5000 }

/**
 * Storey height has a slider (floor height, set on every storey at once);
 * embedment depth has no control yet and is fixed by the design it arrived in.
 * Both are bounded anyway, because a design arriving from storage, a URL or a
 * model's proposal is not constrained by which controls happen to exist today,
 * and a 5000 m storey would sail through the engine and break only the camera.
 */
export const STOREY_HEIGHT_LIMITS_M: Limits = { min: 2, max: 8 }
export const EMBEDMENT_DEPTH_LIMITS_M: Limits = { min: 0, max: 20 }

/** Non-finite input collapses to the low end rather than propagating NaN. */
export function clamp(value: number, limits: Limits): number {
  if (!Number.isFinite(value)) return limits.min
  return Math.min(limits.max, Math.max(limits.min, value))
}

export function withinLimits(value: number, limits: Limits): boolean {
  return Number.isFinite(value) && value >= limits.min && value <= limits.max
}
