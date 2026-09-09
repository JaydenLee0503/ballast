/**
 * The /api/critique endpoint, served by the Vite dev and preview servers.
 *
 * This exists so the API key stays on the server side of the wire. The
 * variables it reads are deliberately NOT prefixed with VITE_, because
 * VITE_-prefixed variables are inlined into the browser bundle and a key must
 * never be one of them. The reading, the call and the error passthrough live in
 * `plugins/aiProvider.ts`, shared with /api/blueprint.
 *
 * It is a dev/preview-time convenience, not a production server. When the app
 * gets deployed the same three steps -- build messages, call the provider,
 * return the text -- move into a serverless function or a Supabase edge
 * function. `buildMessages` is pure and shared, so that move is a transport
 * change and nothing else.
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

export function critiqueApi(options: CritiqueApiOptions): Plugin {
  const handler: Connect.NextHandleFunction = (request, response, next) => {
    if (request.method !== 'POST') {
      next()
      return
    }

    void (async () => {
      const configError = missingConfig(options)
      if (configError !== null) {
        send(response, 503, { error: configError })
        return
      }

      let body: unknown
      try {
        body = await readJsonBody(request)
      } catch {
        send(response, 400, { error: 'Request body was not valid JSON.' })
        return
      }
      if (!hasContext(body)) {
        send(response, 400, { error: 'Request body needs a `context` object.' })
        return
      }

      const outcome = await callProvider({
        options,
        messages: buildMessages(body.context),
        temperature: TEMPERATURE,
        maxTokens: MAX_TOKENS,
      })
      if (!outcome.ok) {
        send(response, outcome.status, { error: outcome.error })
        return
      }
      send(response, 200, { content: outcome.content })
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
