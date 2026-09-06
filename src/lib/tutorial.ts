/**
 * The guided first run, as data.
 *
 * WHY A PLUMB BOB. Bo is a plumb bob: a weight on a string. It is the oldest
 * instrument in the trade and the only one that answers the question this whole
 * studio is about — is the thing standing up straight? It is also, literally,
 * ballast. A mascot that was a hard hat or a friendly cloud would be decoration;
 * this one is the tool the student is being taught to think with, which is why
 * he tilts when a building is in trouble rather than just smiling through it.
 *
 * WHY THE STEPS LIVE HERE. Copy and order are data, separate from the overlay
 * that draws them, so the tour can be read, reordered and tested without
 * rendering anything. Every step names an `anchor` that must exist in the DOM
 * as `data-tour="..."`, and a test asserts the two lists agree — a tour step
 * pointing at a control that was renamed is the classic way these rot.
 *
 * The tour teaches the *loop*, not the interface: choose a building, change it,
 * blow wind at it, read what that cost. A student who finishes it should know
 * why the numbers move, not where every button is.
 */

/** Bo's expressions. Each is a small change of face and tilt, nothing more. */
export type BoMood = 'wave' | 'point' | 'think' | 'cheer'

/**
 * The panel tab a step's anchor lives under.
 *
 * Declared here rather than imported from `App.tsx`, because this module has
 * to stay free of components — but it is the same union, so the two assign to
 * each other structurally and a divergence is a typecheck failure.
 *
 * A step that names a tab is saying "my anchor does not exist unless this tab
 * is open". Without it the tour is silently broken on replay: somebody who
 * opens Bo from the Critique tab would be shown a ring around nothing, because
 * the control being described is not rendered at all.
 */
export type TutorialTab = 'basics' | 'advanced' | 'saved' | 'critique'

export interface TutorialStep {
  readonly id: string
  /**
   * The `data-tour` attribute this step highlights, or null for a step that
   * belongs to the whole screen rather than to one control.
   */
  readonly anchor: string | null
  /**
   * Tab to open before this step can be shown, or null when the anchor is
   * always on screen. `null` rather than an optional property: with
   * `exactOptionalPropertyTypes` on, "absent" and "explicitly nothing" are
   * different types, and every step should have to answer this question.
   */
  readonly tab: TutorialTab | null
  readonly title: string
  readonly body: string
  readonly mood: BoMood
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'welcome',
    tab: null,
    anchor: null,
    title: "Hi, I'm Bo",
    body:
      "I'm a plumb bob — a weight on a string. Builders have hung me next to walls " +
      'for about four thousand years to check they are standing up straight. ' +
      "Let me show you around in about a minute.",
    mood: 'wave',
  },
  {
    id: 'typology',
    tab: 'basics',
    anchor: 'typology',
    title: 'Pick something to build',
    body:
      'A house, a school, a tower — each one starts you somewhere different. ' +
      'They are all just floors stacked up, so every control still works ' +
      'afterwards. Change anything you like.',
    mood: 'point',
  },
  {
    id: 'size',
    tab: 'basics',
    anchor: 'size',
    title: 'Make it yours',
    body:
      'Add floors, make it wider, make it narrower. Watch the model on the left ' +
      'as you drag — every change is redrawn and re-scored immediately.',
    mood: 'point',
  },
  {
    id: 'wind',
    tab: 'basics',
    anchor: 'wind',
    title: 'Now blow a storm at it',
    body:
      'This is the gust speed. Push it up and the wind pushes harder on every ' +
      'floor. This is the moment the design either holds or does not.',
    mood: 'think',
  },
  {
    id: 'storeys',
    tab: null,
    anchor: 'storeys',
    title: 'Green, amber, red',
    body:
      'Each floor is coloured by how hard it is working. Green has room to ' +
      'spare, amber is working hard, red is past its limit. The colours in the ' +
      'table and on the building are the same number.',
    mood: 'point',
  },
  {
    id: 'score',
    tab: null,
    anchor: 'score',
    title: 'What it cost you',
    body:
      'Making a building stronger is never free — it costs carbon and money. ' +
      'That trade is the actual puzzle here. Every one of these numbers comes ' +
      'from the physics, not from a guess.',
    mood: 'think',
  },
  {
    id: 'tabs',
    tab: null,
    anchor: 'tabs',
    title: 'When you want more',
    body:
      'Advanced opens up materials and bracing. Saved keeps designs and makes ' +
      'share links. Critique asks an AI to explain your building — it reads the ' +
      'same numbers you can see, and it is not allowed to invent new ones.',
    mood: 'point',
  },
  {
    id: 'done',
    tab: null,
    anchor: null,
    title: 'Go build something',
    body:
      'Try to get a tall one through a 200 km/h gust without going red — then ' +
      'try to do it with less carbon. You can bring me back any time from the ' +
      'button in the top bar.',
    mood: 'cheer',
  },
]

/** Where a tour that has never run starts. */
export const FIRST_STEP = 0

/**
 * Move through the tour without ever landing outside it.
 *
 * Clamped rather than wrapped: a student who clicks Back on the first step
 * means "nothing", not "jump to the end", and a tour that looped would have no
 * finish. Returns `null` from the last step forward, which is how the overlay
 * knows the tour is over rather than checking the index itself.
 */
export function stepAfter(index: number): number | null {
  if (!Number.isInteger(index) || index < 0) return FIRST_STEP
  return index >= TUTORIAL_STEPS.length - 1 ? null : index + 1
}

export function stepBefore(index: number): number {
  if (!Number.isInteger(index) || index > TUTORIAL_STEPS.length - 1) {
    return TUTORIAL_STEPS.length - 1
  }
  return Math.max(FIRST_STEP, index - 1)
}

export function stepAt(index: number): TutorialStep | undefined {
  return TUTORIAL_STEPS[index]
}

/** Every anchor the tour expects the app to provide. */
export const TUTORIAL_ANCHORS: readonly string[] = TUTORIAL_STEPS.flatMap(
  (step) => (step.anchor === null ? [] : [step.anchor]),
)
