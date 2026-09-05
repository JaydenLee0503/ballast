/**
 * The /api/critique endpoint, served by the Vite dev and preview servers.
 *
 * This exists so the API key stays on the server side of the wire. The
 * variables it reads are deliberately NOT prefixed with VITE_, because
 * VITE_-prefixed variables are inlined into the browser bundle and a key must
 * never be one of them.
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

export interface CritiqueApiOptions {
  apiKey: string | undefined
  model: string | undefined
  baseUrl: string | undefined
}

const DEFAULT_BASE_URL = 'https://api.featherless.ai/v1'
const REQUEST_TIMEOUT_MS = 90_000
/** Enough for a verdict, a paragraph and three suggestions, and no more. */
const MAX_TOKENS = 900
/** Low but not zero: explanation should be steady, not robotic. */
const TEMPERATURE = 0.4

function send(
  response: import('node:http').ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body)
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(payload)
}

async function readJsonBody(
  request: Connect.IncomingMessage,
): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function hasContext(body: unknown): body is { context: CritiqueContext } {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { context?: unknown }).context === 'object' &&
    (body as { context?: unknown }).context !== null
  )
}

function extractContent(payload: unknown): string | null {
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const message = (choices[0] as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return null
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' ? content : null
}

export function critiqueApi(options: CritiqueApiOptions): Plugin {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')

  const handler: Connect.NextHandleFunction = (request, response, next) => {
    if (request.method !== 'POST') {
      next()
      return
    }

    void (async () => {
      if (!options.apiKey) {
        send(response, 503, {
          error:
            'FEATHERLESS_API_KEY is not set. Copy .env.example to .env, add your key, and restart the dev server.',
        })
        return
      }
      if (!options.model) {
        send(response, 503, {
          error:
            'FEATHERLESS_MODEL is not set. Add the exact model id from the Featherless catalogue to .env and restart the dev server.',
        })
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

      try {
        const upstream = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            messages: buildMessages(body.context),
            temperature: TEMPERATURE,
            max_tokens: MAX_TOKENS,
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })

        if (!upstream.ok) {
          // Pass the provider's own message through -- "model not found" and
          // "out of credit" are things the developer needs to read verbatim.
          const detail = (await upstream.text()).slice(0, 500)
          send(response, 502, {
            error: `${options.model} returned HTTP ${upstream.status}. ${detail}`,
          })
          return
        }

        const payload: unknown = await upstream.json()
        const content = extractContent(payload)
        if (content === null) {
          send(response, 502, {
            error: 'The provider replied without any message content.',
          })
          return
        }
        send(response, 200, { content })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        send(response, 502, { error: `Request to the provider failed: ${message}` })
      }
    })()
  }

  const attach = (server: ViteDevServer | PreviewServer): void => {
    server.middlewares.use('/api/critique', handler)
  }

  return {
    name: 'resilience-studio:critique-api',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
