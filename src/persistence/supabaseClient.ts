/**
 * The impure edge of the Supabase integration: reading configuration and
 * holding the one client.
 *
 * Kept apart from `supabase.ts` so the adapter stays a pure function of a
 * client and can be tested without a network, an environment, or the SDK's
 * singleton behaviour.
 *
 * **These variables are `VITE_`-prefixed on purpose**, which looks like it
 * contradicts the rule that made `FEATHERLESS_API_KEY` server-only. It does
 * not. The anon key is a public identifier meant to ship in the bundle; what
 * keeps one student's designs away from another is Row Level Security on the
 * table. The `service_role` key is the secret one and must never appear here.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface SupabaseConfig {
  url: string
  anonKey: string
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * Null when Supabase is not set up. That is a supported way to run Ballast, not
 * a broken install: without it the app keeps designs in the browser and share
 * links still work, so a fresh clone with an empty `.env` is fully usable.
 */
export function supabaseConfig(): SupabaseConfig | null {
  const env = import.meta.env as Record<string, unknown>
  const url = readString(env['VITE_SUPABASE_URL'])
  const anonKey = readString(env['VITE_SUPABASE_ANON_KEY'])
  return url !== null && anonKey !== null ? { url, anonKey } : null
}

let client: SupabaseClient | null = null

/** One client for the page. Two would mean two auth instances racing. */
export function getSupabaseClient(config: SupabaseConfig): SupabaseClient {
  client ??= createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The session is this browser's identity for an anonymous user, so it
      // has to outlive a reload or their saved designs become unreachable.
      storageKey: 'ballast.auth',
    },
  })
  return client
}

let sessionPromise: Promise<void> | null = null

/**
 * Make sure there is a session, signing in anonymously if there is not.
 *
 * Anonymous rather than email because the landing page promises "no account, no
 * download" and means it: a visitor can save on their first click. The cost is
 * that the identity lives in this browser only — clear site data and the
 * designs are unreachable — which is why share links remain the way a design
 * travels between people.
 *
 * Memoised as a promise, not a boolean, because React StrictMode mounts effects
 * twice in development and two concurrent calls would each see "no session" and
 * each create a separate anonymous user.
 */
export function ensureAnonymousSession(client: SupabaseClient): Promise<void> {
  sessionPromise ??= (async () => {
    const { data, error } = await client.auth.getSession()
    if (error) throw new Error(error.message)
    if (data.session !== null) return

    const signIn = await client.auth.signInAnonymously()
    if (signIn.error) throw new Error(signIn.error.message)
  })().catch((cause: unknown) => {
    // Let the next attempt retry rather than caching the failure forever.
    sessionPromise = null
    throw cause
  })
  return sessionPromise
}
