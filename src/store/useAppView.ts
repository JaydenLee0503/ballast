/**
 * Which of the two pages is on screen: the landing page, or the studio.
 *
 * Hash-based rather than a router. One boolean's worth of navigation does not
 * justify a dependency, and a hash needs no server rewrite rule — which
 * matters because this has to work from a static host, a file, or whatever a
 * demo machine happens to be running.
 *
 * The hash is pushed rather than replaced, so the browser Back button returns
 * to the landing page instead of leaving the site.
 */

import { useCallback, useEffect, useState } from 'react'
import { sharedDesignOutcome } from './sharedDesign.ts'

export type AppView = 'landing' | 'studio'

export const STUDIO_HASH = '#studio'

function viewFromLocation(): AppView {
  return window.location.hash === STUDIO_HASH ? 'studio' : 'landing'
}

export interface AppViewState {
  view: AppView
  openStudio: () => void
  openLanding: () => void
}

export function useAppView(): AppViewState {
  const [view, setView] = useState<AppView>(() =>
    // Someone who followed a share link was sent a building, not an invitation
    // to read the pitch. `consumeSharedDesign` has already run and taken the
    // token out of the URL by this point, so the outcome is what to ask.
    sharedDesignOutcome().loadedName !== null ? 'studio' : viewFromLocation(),
  )

  useEffect(() => {
    const onPopState = () => setView(viewFromLocation())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const go = useCallback((next: AppView) => {
    const url =
      next === 'studio'
        ? STUDIO_HASH
        : window.location.pathname + window.location.search
    window.history.pushState(null, '', url)
    setView(next)
  }, [])

  return {
    view,
    openStudio: useCallback(() => go('studio'), [go]),
    openLanding: useCallback(() => go('landing'), [go]),
  }
}
