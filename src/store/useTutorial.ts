/**
 * Whether Bo's tour is running, and how far through it is.
 *
 * Separate from `useDesignStore` because it is not part of the design: nothing
 * here is saved, shared or analysed, and a tour step has no business sitting in
 * the same object as a structure.
 *
 * WHAT IS PERSISTED, AND WHAT IS NOT. Only "this person has finished the tour"
 * survives a reload, and it lives in `localStorage`. The step index does not:
 * somebody who reloads mid-tour is starting again anyway, and restoring them to
 * step five of a tour they do not remember starting is worse than the first
 * step. Storage is wrapped because it throws outright in some privacy modes —
 * a browser refusing to remember must mean "show the tour again", never a
 * blank screen.
 */

import { create } from 'zustand'
import { FIRST_STEP, stepAfter, stepBefore } from '@/lib/tutorial.ts'

/** Versioned: a materially different tour should be shown again, not skipped. */
export const TUTORIAL_SEEN_KEY = 'ballast:tutorial-seen:v1'

function hasFinishedBefore(): boolean {
  try {
    return window.localStorage.getItem(TUTORIAL_SEEN_KEY) === 'yes'
  } catch {
    // Storage blocked. Treat as "never seen": showing a tour twice is a much
    // smaller failure than never showing it at all.
    return false
  }
}

function rememberFinished(): void {
  try {
    window.localStorage.setItem(TUTORIAL_SEEN_KEY, 'yes')
  } catch {
    // Nothing to do. The tour will offer itself again next time, which is the
    // honest consequence of a browser that will not remember.
  }
}

export interface TutorialState {
  /** null when the tour is not on screen. */
  stepIndex: number | null
  start: () => void
  next: () => void
  back: () => void
  /** Leave the tour, by finishing it or by skipping. Both count as seen. */
  close: () => void
}

export const useTutorialStore = create<TutorialState>()((set) => ({
  // Runs itself on a first visit, and stays out of the way afterwards.
  stepIndex: hasFinishedBefore() ? null : FIRST_STEP,

  start: () => set({ stepIndex: FIRST_STEP }),

  next: () =>
    set((state) => {
      if (state.stepIndex === null) return state
      const following = stepAfter(state.stepIndex)
      // `null` means that was the last step: finishing is the same exit as
      // skipping, so it goes through the same door.
      if (following === null) {
        rememberFinished()
        return { stepIndex: null }
      }
      return { stepIndex: following }
    }),

  back: () =>
    set((state) =>
      state.stepIndex === null ? state : { stepIndex: stepBefore(state.stepIndex) },
    ),

  close: () => {
    rememberFinished()
    set({ stepIndex: null })
  },
}))
