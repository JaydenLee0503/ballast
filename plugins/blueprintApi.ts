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
import { buildBlueprintMessages } from '../src/ai/blueprint/prompt.ts'
import type { BlueprintCatalogue } from '../src/ai/blueprint/types.ts'
import {
  callProvider,
  missingConfig,
  readJsonBody,
  send,
  type AiProviderOptions,
  type RouteReply,
} from './aiProvider.ts'

/** A name, a dozen numbers, two short sentences and a list of ids. */
const MAX_TOKENS = 700
const TEMPERATURE = 0.2

/** How much free text the request may carry. A wish, not a brief. */
const MAX_DESCRIPTION_LENGTH = 400

interface BlueprintBody {
  description: string
  catalogue: BlueprintCatalogue
}

function hasBlueprintRequest(body: unknown): body is BlueprintBody {
  if (typeof body !== 'object' || body === null) return false
  const record = body as Record<string, unknown>
  return (
    typeof record['description'] === 'string' &&
    typeof record['catalogue'] === 'object' &&
    record['catalogue'] !== null
  )
}

/**
 * The route, minus HTTP. See the note on `handleCritique`: this plugin is the
 * Vite transport for it and `api/blueprint.ts` is the Vercel one, so the token
 * budget and every validation message exist once.
 */
export async function handleBlueprint(
  options: AiProviderOptions,
  body: unknown,
): Promise<RouteReply> {
  const configError = missingConfig(options)
  if (configError !== null) return { status: 503, body: { error: configError } }
  if (!hasBlueprintRequest(body)) {
    return {
      status: 400,
      body: {
        error: 'Request body needs a `description` string and a `catalogue` object.',
      },
    }
  }

  const description = body.description.trim()
  if (description === '') {
    return { status: 400, body: { error: 'Describe the building you want first.' } }
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return {
      status: 400,
      body: { error: `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.` },
    }
  }

  const outcome = await callProvider({
    options,
    messages: buildBlueprintMessages(description, body.catalogue),
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
  })
  if (!outcome.ok) return { status: outcome.status, body: { error: outcome.error } }
  return { status: 200, body: { content: outcome.content } }
}

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
