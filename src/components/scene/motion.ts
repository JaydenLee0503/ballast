/**
 * How the building moves while the event is running, and how it stands
 * afterwards.
 *
 * Pure functions over engine output and a clock. Two things are worth being
 * precise about, because this is the part of the app most able to lie:
 *
 * **The displacement is real; the scale is not.** A storey's sideways movement
 * is its own `drift_m`, accumulated up the stack — the number in the table, the
 * number the drift dial reads, the number the code limit is checked against. At
 * true scale it is invisible: the h/500 limit on a 21 m building is 42 mm, a
 * pixel at the zoom a whole tower is framed at. So it is multiplied by
 * `MOTION_EXAGGERATION`, and the overlay says so on screen in those words. A
 * simulation that quietly drew an exaggerated lean would be teaching students
 * that buildings visibly wobble in a breeze.
 *
 * **The pose is the engine's verdict, not the animation's.** Which storeys
 * crack and which collapse is `DamageState`, banded from utilisation in
 * `engine/damage.ts`. Nothing here decides an outcome; it decides when and how
 * far to move.
 *
 * The oscillation itself is a shape, not a prediction. This engine has no
 * dynamic analysis — no mode shapes, no damping ratio, no time history — so the
 * *frequency* on screen is chosen to read correctly (an earthquake is fast and
 * two-sided, a gust is slow and one-sided) and means nothing quantitative. The
 * amplitude is the part that comes from the engine.
 */

import type { Hazard } from '@/engine'
import type { SimulationPhase } from '@/store/useSimulation.ts'
import { IMPACT_MS } from '@/store/useSimulation.ts'

/**
 * How much bigger than life the movement is drawn.
 *
 * Chosen so the serviceability drift limit — h/500, the boundary the amber band
 * sits on — is just visible as a lean on a mid-rise building at the default
 * framing, and a design at twice the limit is unmistakable. Stated on screen
 * beside the animation rather than buried here.
 */
export const MOTION_EXAGGERATION = 45

/**
 * The drawn lean is capped at this fraction of the storey's own width.
 *
 * A DRAWING LIMIT, not a modelling one. A collapsing design reports drift
 * ratios of 10% and more, which at the exaggeration above would throw storeys
 * several plan-widths sideways and off the screen — and a building nobody can
 * see is a worse explanation than one leaning hard. The figures in the table
 * are not capped, and a storey at the cap is always also drawn as failed.
 */
export const LEAN_CAP_FRACTION = 0.85

/** Cycles per second of the drawn oscillation, per hazard. Read, not computed. */
const SWAY_FREQUENCY_HZ: Readonly<Record<Hazard['kind'], number>> = {
  // A gust builds and passes over a second or two.
  wind: 0.55,
  // Strong ground motion is fast: 1-3 Hz is where most of the energy is.
  seismic: 2.1,
  // Flood load is quasi-static. It leans on the building; it does not shake it.
  flood: 0.25,
}

/**
 * Whether the load reverses.
 *
 * Wind and flowing water push one way, so the building leans downwind and
 * trembles about that leaning position. An earthquake throws the ground both
 * ways, so the building swings through vertical. Getting this wrong would make
 * an earthquake look like a strong breeze.
 */
const TWO_SIDED: Readonly<Record<Hazard['kind'], boolean>> = {
  wind: false,
  seismic: true,
  flood: false,
}

export interface SimulationMotion {
  phase: SimulationPhase
  /** 0..1 through the impact phase. */
  progress: number
  /**
   * -1..1 for a two-sided hazard, 0..1 for a one-sided one. Multiplied by the
   * storey's own exaggerated drift to get where it is drawn.
   */
  oscillation: number
  /** 0..1 amplitude envelope: it builds, holds, and passes. */
  envelope: number
  /** 0..1, how much of the permanent damaged pose is applied. */
  pose: number
  /** 0..1, how far the flood has risen towards its stillwater depth. */
  waterRise: number
}

export const RESTING_MOTION: SimulationMotion = {
  phase: 'idle',
  progress: 0,
  oscillation: 0,
  envelope: 0,
  pose: 0,
  waterRise: 1,
}

/** Smooth 0..1 ramp. Cheaper than a cubic and indistinguishable at this size. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Seconds into the impact at which the building starts taking its final pose. */
const POSE_START = 0.5
/** Fraction of the impact over which the shaking builds up and then passes. */
const RAMP_IN = 0.14
const RAMP_OUT = 0.78

/**
 * The whole motion state at one instant.
 *
 * `elapsed_s` is time since the *current phase* began, which is what the store
 * records — so this function needs no memory and can be called fresh every
 * frame from anywhere in the scene.
 */
export function motionAt(
  phase: SimulationPhase,
  elapsed_s: number,
  hazardKind: Hazard['kind'],
): SimulationMotion {
  if (phase === 'idle') return RESTING_MOTION

  if (phase === 'bracing') {
    // Nothing has hit yet. The water is already there, because a flood is a
    // condition the building is standing in rather than an arrival.
    return { ...RESTING_MOTION, phase, waterRise: hazardKind === 'flood' ? 0 : 1 }
  }

  if (phase === 'aftermath') {
    return {
      phase,
      progress: 1,
      oscillation: 0,
      envelope: 0,
      pose: 1,
      waterRise: 1,
    }
  }

  const progress = Math.min(1, Math.max(0, elapsed_s / (IMPACT_MS / 1000)))
  const envelope =
    smoothstep(0, RAMP_IN, progress) * (1 - smoothstep(RAMP_OUT, 1, progress) * 0.9)

  const cycle = Math.sin(2 * Math.PI * SWAY_FREQUENCY_HZ[hazardKind] * elapsed_s)
  // A second, slower component so the shaking does not read as a metronome.
  const wobble = Math.sin(2 * Math.PI * SWAY_FREQUENCY_HZ[hazardKind] * 0.37 * elapsed_s)
  const combined = cycle * 0.75 + wobble * 0.25

  return {
    phase,
    progress,
    oscillation: TWO_SIDED[hazardKind] ? combined : 0.5 + 0.5 * combined,
    envelope,
    // The damage arrives during the second half of the event, so a student sees
    // the building fail rather than finding out afterwards.
    pose: smoothstep(POSE_START, 1, progress),
    waterRise: hazardKind === 'flood' ? smoothstep(0, 0.7, progress) : 1,
  }
}

export interface StoreyPose {
  /** Lateral offset along the hazard's direction, in metres, as drawn. */
  offset_m: number
  /** Extra fall for a storey at or above the collapse, in metres. */
  drop_m: number
  /** Tilt about the axis across the load, in radians. */
  tilt_rad: number
}

export interface StoreyPoseInput {
  index: number
  /**
   * This storey's total sideways displacement relative to the ground, in
   * metres: its own `drift_m` plus every storey's below it. Straight from
   * `AnalysisResult`.
   */
  cumulativeDrift_m: number
  /** Narrower plan dimension of this storey, for the drawing cap. */
  width_m: number
  /** Index of the lowest collapsed storey, or null if none collapsed. */
  collapseIndex: number | null
  /** Height of this storey, used to size how far a collapse falls. */
  height_m: number
}

/**
 * Where one storey is drawn, given the motion state.
 *
 * A collapsed storey and everything above it fall and tip, because a storey
 * that has lost its capacity is no longer holding up what is on top of it.
 * The fall is a fraction of the collapsed storey's own height rather than a
 * fixed distance, so a 3 m flat and an 8 m hall do not collapse by the same
 * amount.
 */
export function storeyPose(
  input: StoreyPoseInput,
  motion: SimulationMotion,
): StoreyPose {
  const cap = input.width_m * LEAN_CAP_FRACTION
  const lean_m = Math.min(
    Math.abs(input.cumulativeDrift_m) * MOTION_EXAGGERATION,
    cap,
  )
  // During the event the storey swings; as the event passes, the swing gives
  // way to whatever pose it has been left in. The two cross over smoothly, so
  // there is no jump when the shaking stops.
  const amount =
    motion.envelope * motion.oscillation + (1 - motion.envelope) * motion.pose

  const collapsing =
    motion.pose > 0 &&
    input.collapseIndex !== null &&
    input.index >= input.collapseIndex

  return {
    offset_m: lean_m * amount,
    drop_m: collapsing ? motion.pose * input.height_m * 0.55 : 0,
    // Alternating sign by index, so a collapsed stack folds rather than
    // toppling as one rigid block — which is what a stack of failed storeys
    // actually does, and reads as rubble rather than as a felled tree.
    tilt_rad: collapsing
      ? motion.pose * 0.16 * (input.index % 2 === 0 ? 1 : -1)
      : 0,
  }
}

/**
 * Running total of drift up the stack.
 *
 * `StoreyResult.drift_m` is each storey's movement *relative to the one below*,
 * which is what a drift limit is about. What gets drawn is absolute movement
 * relative to the ground, so it has to be accumulated — and getting that wrong
 * would draw a building that shears at every floor instead of leaning.
 */
export function cumulativeDrift_m(drifts_m: readonly number[]): number[] {
  const out: number[] = []
  let total = 0
  for (const drift of drifts_m) {
    total += Number.isFinite(drift) ? drift : 0
    out.push(total)
  }
  return out
}
