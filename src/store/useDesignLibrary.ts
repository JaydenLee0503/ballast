/**
 * Deciding where designs are kept.
 *
 * Three outcomes, in order of preference: the student's Supabase account, this
 * browser's localStorage, or nowhere. The component that saves and loads never
 * learns which — it awaits the same four methods either way — so this is the
 * only file that knows a network is involved at all.
 *
 * **Cloud failure falls back rather than breaking.** If Supabase is configured
 * but unreachable, or anonymous sign-in is switched off in the dashboard, the
 * app drops to browser storage and says so. Saving locally is a much better
 * outcome than a save button that throws, and during a demo on bad wifi it is
 * the difference between a working app and a broken one.
 */

import { useEffect, useMemo, useState } from 'react'
import { MATERIAL_LIBRARY } from '@/engine'
import {
  browserStorage,
  createLocalDesignLibrary,
  createSupabaseDesignLibrary,
  ensureAnonymousSession,
  getSupabaseClient,
  supabaseConfig,
  type DesignLibrary,
} from '@/persistence'

export type LibraryBackend = 'connecting' | 'cloud' | 'browser' | 'none'

export interface DesignLibraryState {
  library: DesignLibrary | null
  backend: LibraryBackend
  /** Why the cloud was not used. Non-fatal; the app has already fallen back. */
  notice: string | null
}

function localLibrary(): DesignLibrary | null {
  const storage = browserStorage()
  return storage === null
    ? null
    : createLocalDesignLibrary({ storage, materials: MATERIAL_LIBRARY })
}

export function useDesignLibrary(): DesignLibraryState {
  // Read once: whether Supabase is configured cannot change while the page is
  // open, and re-reading would make the fallback state flicker.
  const config = useMemo(() => supabaseConfig(), [])
  const fallback = useMemo(() => localLibrary(), [])

  const [state, setState] = useState<DesignLibraryState>(() =>
    config === null
      ? {
          library: fallback,
          backend: fallback === null ? 'none' : 'browser',
          notice: null,
        }
      : { library: null, backend: 'connecting', notice: null },
  )

  useEffect(() => {
    if (config === null) return
    let cancelled = false

    const client = getSupabaseClient(config)
    ensureAnonymousSession(client)
      .then(() => {
        if (cancelled) return
        setState({
          library: createSupabaseDesignLibrary(client, MATERIAL_LIBRARY),
          backend: 'cloud',
          notice: null,
        })
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setState({
          library: fallback,
          backend: fallback === null ? 'none' : 'browser',
          notice: `Could not reach your account (${
            cause instanceof Error ? cause.message : String(cause)
          }). Designs are being kept in this browser instead.`,
        })
      })

    return () => {
      cancelled = true
    }
  }, [config, fallback])

  return state
}
