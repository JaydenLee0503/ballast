/**
 * Designs as links.
 *
 * A student sends a URL and the person who opens it sees the same building
 * under the same wind, with no account, no server and no database row. For a
 * classroom that is most of what "saved designs" has to mean, and it works
 * before Supabase exists and still works if it goes down.
 *
 * The payload is the same `SavedDesign` the local library stores, so a link
 * is validated by the same `parseDesign` as everything else. There is no
 * second format and no second set of rules to keep in step.
 *
 * The token lives in the URL *fragment*, not the query string. Fragments are
 * not sent to the server and do not turn up in access logs or referrer
 * headers. Nothing here is secret, but a design is a student's work, and the
 * fragment is free.
 */

import type { MaterialLibrary } from '@/engine'
import {
  DesignParseError,
  parseDesignJson,
  serializeDesign,
  type SavedDesign,
} from './schema.ts'

/** Fragment key, as in `#design=<token>`. */
export const SHARE_FRAGMENT_KEY = 'design'

/**
 * Encoding budget. Measured: the default six-storey design encodes to 1276
 * characters, and a 24-storey one — the largest the limits allow — to 4060.
 * Every current browser handles that comfortably (Chrome's practical ceiling
 * is ~32 kB, Safari's ~64 kB), though it is long enough to look alarming
 * pasted into a chat window. `share.test.ts` pins the maximum so a schema
 * change that inflates it is visible here rather than discovered by a student
 * whose link stopped working.
 *
 * If it ever needs to shrink, the win is structural rather than algorithmic:
 * storeys repeat almost exactly, so collapsing runs of identical storeys would
 * cut a uniform tower to near-constant size. Not worth the format complexity
 * until a real link is actually too long.
 */
export const MAX_TOKEN_LENGTH = 8192

function toBase64Url(bytes: Uint8Array): string {
  // Built one chunk at a time: String.fromCharCode(...bytes) spreads every
  // byte as an argument and overflows the call stack on large inputs.
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function fromBase64Url(token: string): Uint8Array {
  const base64 = token.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** UTF-8 first, so a design named in any script survives the round trip. */
export function encodeDesign(design: SavedDesign): string {
  return toBase64Url(new TextEncoder().encode(serializeDesign(design)))
}

export function decodeDesign(token: string, library: MaterialLibrary): SavedDesign {
  if (token.length > MAX_TOKEN_LENGTH) {
    throw new DesignParseError(
      `share token is ${token.length} characters, over the ${MAX_TOKEN_LENGTH} limit`,
    )
  }
  let json: string
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(token))
  } catch {
    // atob on a non-base64 character, or bytes that are not valid UTF-8. Both
    // mean the same thing to the person holding the link: it is truncated.
    throw new DesignParseError('share link is damaged or incomplete')
  }
  return parseDesignJson(json, library)
}

/** Absolute link to `design`, reusing the origin and path of `pageUrl`. */
export function shareUrl(design: SavedDesign, pageUrl: string): string {
  const url = new URL(pageUrl)
  url.hash = `${SHARE_FRAGMENT_KEY}=${encodeDesign(design)}`
  return url.toString()
}

/** The token in a URL's fragment, or null if there is not one. */
export function readShareToken(pageUrl: string): string | null {
  let hash: string
  try {
    hash = new URL(pageUrl).hash
  } catch {
    return null
  }
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const token = params.get(SHARE_FRAGMENT_KEY)
  return token !== null && token.length > 0 ? token : null
}
