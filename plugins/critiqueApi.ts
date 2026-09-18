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
 * `handleCritique` in `routes.ts`, which knows nothing about HTTP beyond a
 * status number and imports no Vite. This plugin is the dev/preview transport
 * for it; `api/critique.ts` is the Vercel one. Two callers, one implementation,
 * and no second copy of the token budget or the validation to drift.
 */

import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite'
import { readJsonBody, send, type AiProviderOptions } from './aiProvider.ts'
import { handleCritique } from './routes.ts'

/** Kept as a named export: it was this module's option type first. */
export type CritiqueApiOptions = AiProviderOptions

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
