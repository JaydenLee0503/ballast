/**
 * Opening a design that arrived as a link.
 *
 * This runs once, from `main.tsx`, before React renders — not from an effect.
 * The fragment is already in the address bar at that point, so there is
 * nothing to wait for, and loading it in an effect would paint the default
 * building first and swap it a frame later. A shared link should open on the
 * design it names, not flash something else on the way.
 *
 * `Navigation` is the whole browser surface this needs, which keeps the
 * decode-and-clear behaviour testable without a DOM.
 */

import { MATERIAL_LIBRARY } from '@/engine'
import { decodeDesign, readShareToken } from '@/persistence'
import { useDesignStore } from './design.ts'

export interface Navigation {
  /** The current URL, fragment included. */
  href: string
  /** Replace it without adding a history entry. */
  replace: (url: string) => void
}

export interface SharedDesignOutcome {
  /** Name of the design opened from a link, if one was. */
  loadedName: string | null
  /** Why a link failed. A damaged link should say so, not fail silently. */
  error: string | null
}

const NOTHING_SHARED: SharedDesignOutcome = { loadedName: null, error: null }

let outcome: SharedDesignOutcome = NOTHING_SHARED

/** The browser's real URL bar. */
export function windowNavigation(): Navigation {
  return {
    href: window.location.href,
    replace: (url) => window.history.replaceState(null, '', url),
  }
}

/**
 * Read a design out of the URL fragment, load it, and take it back out of the
 * address bar.
 *
 * The fragment is cleared whether or not the design loads. A link that fails
 * to decode must not sit in the address bar reproducing the failure on every
 * refresh, and after a successful load the URL should describe where the
 * student is now — four kilobytes of stale base64 would make every subsequent
 * copy of the URL the wrong thing to send.
 */
export function consumeSharedDesign(navigation: Navigation): SharedDesignOutcome {
  const token = readShareToken(navigation.href)
  if (token === null) {
    outcome = NOTHING_SHARED
    return outcome
  }

  const url = new URL(navigation.href)
  url.hash = ''
  navigation.replace(url.toString())

  try {
    const design = decodeDesign(token, MATERIAL_LIBRARY)
    useDesignStore.getState().loadDesign(design)
    outcome = { loadedName: design.name, error: null }
  } catch (error) {
    outcome = {
      loadedName: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  return outcome
}

/**
 * What `consumeSharedDesign` found. Safe to read during render: it is written
 * once, before the first one, and never again.
 */
export function sharedDesignOutcome(): SharedDesignOutcome {
  return outcome
}
