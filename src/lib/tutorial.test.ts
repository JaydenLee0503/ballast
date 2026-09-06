import { expect, it } from 'vitest'
import {
  FIRST_STEP,
  stepAfter,
  stepAt,
  stepBefore,
  TUTORIAL_ANCHORS,
  TUTORIAL_STEPS,
  type BoMood,
} from '@/lib/tutorial.ts'

/**
 * Every component's source, as text.
 *
 * `import.meta.glob` rather than `node:fs`: the app's tsconfig deliberately
 * ships only `vite/client` types, so a test that reached for a Node builtin
 * would either fail to typecheck or force Node's globals into the app project.
 * Vite's raw import is the same read, through a door this project already has
 * open — and it scans every component rather than a hand-listed pair, so an
 * anchor moved to a new file still counts.
 */
const SOURCES = import.meta.glob('/src/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const allSource = Object.values(SOURCES).join('\n')

it('points every step at an anchor the app actually renders', () => {
  // The failure this exists to catch: somebody renames a control, the tour
  // keeps pointing at the old name, and the ring silently stops being drawn.
  // Nothing throws in that case, so only a test notices.
  for (const anchor of TUTORIAL_ANCHORS) {
    expect(
      allSource.includes(`data-tour="${anchor}"`),
      `no element carries data-tour="${anchor}"`,
    ).toBe(true)
  }
})

it('does not leave an anchor in the app that no step uses', () => {
  // A plain identifier only. The tour component itself contains the selector
  // `data-tour="${anchor}"` as a template literal, and a looser pattern reads
  // that placeholder back as though it were an anchor named "${anchor}".
  const found = [...allSource.matchAll(/data-tour="([a-z][a-z0-9-]*)"/g)].map(
    (match) => match[1],
  )
  for (const anchor of found) {
    expect(TUTORIAL_ANCHORS, `data-tour="${anchor}" is unused`).toContain(anchor)
  }
})

it('walks forward and stops at the end rather than wrapping', () => {
  expect(stepAfter(0)).toBe(1)
  // The last step returns null, which is how the overlay learns the tour is
  // finished without having to know its own length.
  expect(stepAfter(TUTORIAL_STEPS.length - 1)).toBeNull()
})

it('walks back and stops at the start', () => {
  expect(stepBefore(3)).toBe(2)
  expect(stepBefore(FIRST_STEP)).toBe(FIRST_STEP)
})

it('recovers from an index that should not exist', () => {
  // Defensive: a stale index from a hot reload must not blank the tour.
  expect(stepAfter(-4)).toBe(FIRST_STEP)
  expect(stepAfter(1.5)).toBe(FIRST_STEP)
  expect(stepBefore(999)).toBe(TUTORIAL_STEPS.length - 1)
  expect(stepAt(999)).toBeUndefined()
})

it('gives every step an id, a title and something to say', () => {
  const ids = TUTORIAL_STEPS.map((step) => step.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const step of TUTORIAL_STEPS) {
    expect(step.title.length, step.id).toBeGreaterThan(0)
    // Long enough to explain something, short enough to read in a card.
    expect(step.body.length, step.id).toBeGreaterThan(40)
    expect(step.body.length, step.id).toBeLessThan(320)
  }
})

it('only asks Bo for faces he can pull', () => {
  const moods: readonly BoMood[] = ['wave', 'point', 'think', 'cheer']
  for (const step of TUTORIAL_STEPS) {
    expect(moods, step.id).toContain(step.mood)
  }
})

it('opens and closes on a step that belongs to the whole screen', () => {
  // The first and last steps introduce and send off; neither should drag a
  // highlight ring onto an unrelated control.
  expect(TUTORIAL_STEPS[0]?.anchor).toBeNull()
  expect(TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1]?.anchor).toBeNull()
})

it('declares a tab for every anchor that lives inside the tabbed panel', () => {
  // The failure this catches: an anchor is added under a tab, the step forgets
  // to name it, and the tour rings nothing whenever that tab is not already
  // open. Nothing throws — the ring is just silently absent.
  const controls = SOURCES['/src/components/DesignControls.tsx'] ?? ''
  expect(controls.length, 'DesignControls source not found').toBeGreaterThan(0)

  for (const step of TUTORIAL_STEPS) {
    if (step.anchor === null) continue
    if (controls.includes(`data-tour="${step.anchor}"`)) {
      expect(step.tab, `${step.id} points into a tab but names none`).not.toBeNull()
    }
  }
})

it('does not demand a tab for anchors that are always on screen', () => {
  // The scorecard, the storey table and the tab rail itself sit outside the
  // tabs. Asking to switch tab for one of those would yank the panel around
  // for no reason.
  const shell = SOURCES['/src/App.tsx'] ?? ''
  expect(shell.length, 'App source not found').toBeGreaterThan(0)

  for (const step of TUTORIAL_STEPS) {
    if (step.anchor === null) continue
    const inShell = shell.includes(`data-tour="${step.anchor}"`)
    const inControls = (SOURCES['/src/components/DesignControls.tsx'] ?? '').includes(
      `data-tour="${step.anchor}"`,
    )
    if (inShell && !inControls) {
      expect(step.tab, `${step.id} is always visible and needs no tab`).toBeNull()
    }
  }
})
