/**
 * The simulation's motion, which is the one part of the app allowed to
 * exaggerate — so it is the part most worth pinning.
 *
 * Two claims are load-bearing and both are tested here: the movement is
 * proportional to the engine's own drift (so a stiffer design visibly moves
 * less), and the pose never invents a collapse — a storey only falls when it is
 * at or above the index the engine put in `DamageReport.collapseIndex`.
 */

import { describe, expect, it } from 'vitest'
import { IMPACT_MS } from '@/store/useSimulation.ts'
import {
  cumulativeDrift_m,
  LEAN_CAP_FRACTION,
  MOTION_EXAGGERATION,
  motionAt,
  RESTING_MOTION,
  storeyPose,
  type StoreyPoseInput,
} from './motion.ts'

const IMPACT_S = IMPACT_MS / 1000

const POSE: StoreyPoseInput = {
  index: 2,
  cumulativeDrift_m: 0.05,
  width_m: 12,
  collapseIndex: null,
  height_m: 3.5,
}

describe('the phases', () => {
  it('does nothing at all when nothing is running', () => {
    expect(motionAt('idle', 10, 'wind')).toEqual(RESTING_MOTION)
  })

  it('carries nothing that moves the flood surface', () => {
    // The water stands at the depth the engine analysed for the whole run. An
    // earlier version raised it during the impact, which meant pressing Start
    // snapped a standing flood down to the ground and then refilled it. Pinned
    // as a key list so re-adding a rise has to come past this test.
    expect(Object.keys(motionAt('impact', 1, 'flood')).sort()).toEqual([
      'envelope',
      'oscillation',
      'phase',
      'pose',
      'progress',
    ])
  })

  it('has not hit yet while bracing', () => {
    const braced = motionAt('bracing', 0.5, 'seismic')
    expect(braced.oscillation).toBe(0)
    expect(braced.pose).toBe(0)
  })

  it('holds the damaged pose in the aftermath, with no shaking left', () => {
    const after = motionAt('aftermath', 30, 'seismic')
    expect(after.pose).toBe(1)
    expect(after.envelope).toBe(0)
    expect(after.oscillation).toBe(0)
  })
})

describe('the impact', () => {
  it('builds up and passes rather than starting at full strength', () => {
    expect(motionAt('impact', 0, 'wind').envelope).toBeCloseTo(0, 6)
    const peak = motionAt('impact', IMPACT_S * 0.5, 'wind').envelope
    const end = motionAt('impact', IMPACT_S, 'wind').envelope
    expect(peak).toBeGreaterThan(0.9)
    expect(end).toBeLessThan(peak)
  })

  it('swings both ways in an earthquake and one way in a storm', () => {
    const samples = (kind: 'wind' | 'seismic') =>
      Array.from({ length: 200 }, (_, i) =>
        motionAt('impact', (i / 200) * IMPACT_S, kind).oscillation,
      )
    expect(Math.min(...samples('seismic'))).toBeLessThan(-0.5)
    expect(Math.min(...samples('wind'))).toBeGreaterThanOrEqual(0)
  })

  it('reaches its final pose by the end, so the aftermath does not jump', () => {
    expect(motionAt('impact', IMPACT_S, 'wind').pose).toBeCloseTo(1, 6)
  })
})

describe('where a storey is drawn', () => {
  const settled = motionAt('aftermath', 0, 'wind')

  it('is the engine drift, multiplied by the stated exaggeration', () => {
    const pose = storeyPose({ ...POSE, cumulativeDrift_m: 0.05 }, settled)
    expect(pose.offset_m).toBeCloseTo(0.05 * MOTION_EXAGGERATION, 6)
  })

  it('moves a floppier building further, which is the whole point', () => {
    const stiff = storeyPose({ ...POSE, cumulativeDrift_m: 0.01 }, settled)
    const floppy = storeyPose({ ...POSE, cumulativeDrift_m: 0.04 }, settled)
    expect(floppy.offset_m).toBeGreaterThan(stiff.offset_m)
  })

  it('caps the drawn lean so a failing design stays on screen', () => {
    const wild = storeyPose({ ...POSE, cumulativeDrift_m: 100 }, settled)
    expect(wild.offset_m).toBeCloseTo(POSE.width_m * LEAN_CAP_FRACTION, 6)
  })

  it('never invents a collapse', () => {
    expect(storeyPose(POSE, settled).drop_m).toBe(0)
    expect(storeyPose(POSE, settled).tilt_rad).toBe(0)
  })

  it('drops a storey only at or above the index the engine gave', () => {
    const collapsing = { ...POSE, collapseIndex: 2 }
    expect(storeyPose({ ...collapsing, index: 1 }, settled).drop_m).toBe(0)
    expect(storeyPose({ ...collapsing, index: 2 }, settled).drop_m).toBeGreaterThan(0)
    expect(storeyPose({ ...collapsing, index: 5 }, settled).drop_m).toBeGreaterThan(0)
  })

  it('keeps everything still before the event starts', () => {
    const pose = storeyPose(
      { ...POSE, collapseIndex: 0, cumulativeDrift_m: 1 },
      RESTING_MOTION,
    )
    expect(pose.offset_m).toBe(0)
    expect(pose.drop_m).toBe(0)
  })
})

describe('accumulating drift', () => {
  it('sums up the stack, because drift is relative to the storey below', () => {
    expect(cumulativeDrift_m([0.01, 0.02, 0.03])).toEqual([0.01, 0.03, 0.06])
  })

  it('survives an infinite drift without poisoning the whole stack', () => {
    // A storey with no lateral system reports an infinite drift. The drawn
    // building should still be drawn.
    const out = cumulativeDrift_m([0.01, Number.POSITIVE_INFINITY, 0.01])
    expect(out.every((value) => Number.isFinite(value))).toBe(true)
  })
})
