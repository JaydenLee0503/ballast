/**
 * The /api/blueprint endpoint, served by the Vite dev and preview servers.
 *
 * The sibling of /api/critique, and the same three steps: build messages, call
 * the provider, return the text. Both routes go through `plugins/aiProvider.ts`,
 * so the key is read in one place and neither route can drift from the other on
 * timeouts or error passthrough.
 *
 * The reply this asks for is a small JSON object of slider positions, so it
 * needs far fewer tokens than a critique, and a lower temperature: this is a
 * lookup-and-choose task, and creative variance here shows up as an id that is
 * not in the catalogue.
 */

import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite'
import { readJsonBody, send, type AiProviderOptions } from './aiProvider.ts'
import { handleBlueprint } from './routes.ts'

export function blueprintApi(options: AiProviderOptions): Plugin {
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
      const reply = await handleBlueprint(options, body)
      send(response, reply.status, reply.body)
    })()
  }

  const attach = (server: ViteDevServer | PreviewServer): void => {
    server.middlewares.use('/api/blueprint', handler)
  }

  return {
    name: 'ballast:blueprint-api',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
