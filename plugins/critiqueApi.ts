/**
 * The /api/critique endpoint, served by the Vite dev and preview servers.
 *
 * This exists so the API key stays on the server side of the wire. The
 * variables it reads are deliberately NOT prefixed with VITE_, because
 * VITE_-prefixed variables are inlined into the browser bundle and a key must
 * never be one of them. The reading, the call and the error passthrough live in
 * `plugins/aiProvider.ts`, shared with /api/blueprint.
 *
 * WHAT IS TRANSPORT AND WHAT IS NOT. The decisions -- is the config present,
 * is the body the right shape, what does the provider say -- live in
 * `handleCritique`, which knows nothing about HTTP beyond a status number. This
 * plugin is the Vite dev/preview transport for it; `api/critique.ts` is the
 * Vercel one. That is what "a transport change and nothing else" has to mean in
 * practice: two callers, one implementation, and no second copy of the token
 * budget or the validation to drift.
 */

import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite'
import { buildMessages } from '../src/ai/prompt.ts'
import type { CritiqueContext } from '../src/ai/types.ts'
import {
  callProvider,
  missingConfig,
  readJsonBody,
  send,
  type AiProviderOptions,
  type RouteReply,
} from './aiProvider.ts'

/** Kept as a named export: it was this module's option type first. */
export type CritiqueApiOptions = AiProviderOptions

/** Enough for a verdict, a paragraph and three suggestions, and no more. */
const MAX_TOKENS = 900
/** Low but not zero: explanation should be steady, not robotic. */
const TEMPERATURE = 0.4

function hasContext(body: unknown): body is { context: CritiqueContext } {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { context?: unknown }).context === 'object' &&
    (body as { context?: unknown }).context !== null
  )
}

/**
 * The route, minus HTTP.
 *
 * Takes an already-parsed body because the two transports read one very
 * differently -- a Node stream here, `await request.json()` on Vercel -- and
 * that difference is the only thing they should disagree about.
 */
export async function handleCritique(
  options: AiProviderOptions,
  body: unknown,
): Promise<RouteReply> {
  const configError = missingConfig(options)
  if (configError !== null) return { status: 503, body: { error: configError } }
  if (!hasContext(body)) {
    return { status: 400, body: { error: 'Request body needs a `context` object.' } }
  }

  const outcome = await callProvider({
    options,
    messages: buildMessages(body.context),
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
  })
  if (!outcome.ok) return { status: outcome.status, body: { error: outcome.error } }
  return { status: 200, body: { content: outcome.content } }
}

export function critiqueApi(options: CritiqueApiOptions): Plugin {
  const handler: Connect.NextHandleFunction = (request, response, next) => {
    if (request.method !== 'POST') {
      next()
      return
    }

    void (async () => {
      let body: unknown
      try {
        body = await readJsonBody(request)
      } catch {
        send(response, 400, { error: 'Request body was not valid JSON.' })
        return
      }
      const reply = await handleCritique(options, body)
      send(response, reply.status, reply.body)
    })()
  }

  const attach = (server: ViteDevServer | PreviewServer): void => {
    server.middlewares.use('/api/critique', handler)
  }

  return {
    name: 'ballast:critique-api',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
