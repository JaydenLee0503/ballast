/**
 * What the thing pointing at the screen is.
 *
 * Two questions, and they are genuinely different. **`useCoarsePointer`** asks
 * what this device mostly is, which is what the copy and the render resolution
 * have to be chosen from before anybody touches anything. **`isTouchPointer`**
 * asks what a particular event came from, which is what interaction has to
 * branch on — a tablet with a keyboard and a stylus answers the first question
 * "coarse" and the second one differently event by event.
 *
 * Both are here rather than inside a component because the answer is a
 * property of the session, not of any one panel, and because a media query
 * read in three places is three places to forget the listener.
 */

import { useEffect, useState } from 'react'

const COARSE_QUERY = '(pointer: coarse)'

/** True on a phone or a tablet; false for a mouse or a trackpad. */
export function coarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia(COARSE_QUERY).matches
}

/**
 * The same answer, kept current. It can change without a reload — a tablet
 * docked into a keyboard is the ordinary case — so the query is subscribed to
 * rather than read once at mount.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(coarsePointer)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const query = window.matchMedia(COARSE_QUERY)
    const onChange = () => setCoarse(query.matches)
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return coarse
}

/**
 * Whether this particular event came from a finger.
 *
 * Pen counts as a fine pointer: a stylus hovers, and hover is the thing this
 * question is usually asked about.
 */
export function isTouchPointer(event: { pointerType?: string }): boolean {
  return event.pointerType === 'touch'
}
