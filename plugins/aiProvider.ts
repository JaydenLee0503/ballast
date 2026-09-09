/**
 * The one place the provider key is used, shared by the two AI routes.
 *
 * `/api/critique` (prose about a design) and `/api/blueprint` (a design to start
 * from) differ only in which pure `buildMessages` function they call and how
 * many tokens the reply needs. Everything else — the key, the timeout, the
 * OpenAI-compatible request shape, and passing the provider's own error text
 * through verbatim because "model not found" and "out of credit" are things a
 * developer has to read — is identical, so it lives here once.
 *
 * Still dev and preview only. These are Vite middlewares, not a production
 * server; deploying means moving `callProvider` and one `buildMessages` into a
 * serverless or edge function, which is a transport change and nothing else
 * because every message builder is pure.
 */

import type { Connect } from 'vite'
import type { ServerResponse } from 'node:http'

export interface AiProviderOptions {
  apiKey: string | undefined
  model: string | undefined
  baseUrl: string | undefined
}

export const DEFAULT_BASE_URL = 'https://api.featherless.ai/v1'
export const REQUEST_TIMEOUT_MS = 90_000

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(body))
}

export async function readJsonBody(
  request: Connect.IncomingMessage,
): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function extractContent(payload: unknown): string | null {
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const message = (choices[0] as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return null
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' ? content : null
}

/**
 * Missing configuration is reported as a 503 with the variable's name in it,
 * rather than as a silent fallback. There is no default model on purpose: a
 * quiet substitution of a model you did not choose is worse than an error.
 */
export function missingConfig(options: AiProviderOptions): string | null {
  if (!options.apiKey) {
    return 'FEATHERLESS_API_KEY is not set. Copy .env.example to .env, add your key, and restart the dev server.'
  }
  if (!options.model) {
    return 'FEATHERLESS_MODEL is not set. Add the exact model id from the Featherless catalogue to .env and restart the dev server.'
  }
  return null
}

export interface ProviderCall {
  options: AiProviderOptions
  messages: ChatMessage[]
  temperature: number
  maxTokens: number
}

export type ProviderOutcome =
  | { ok: true; content: string }
  | { ok: false; status: number; error: string }

export async function callProvider(call: ProviderCall): Promise<ProviderOutcome> {
  const { options } = call
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.apiKey ?? ''}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: call.messages,
        temperature: call.temperature,
        max_tokens: call.maxTokens,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, 500)
      return {
        ok: false,
        status: 502,
        error: `${options.model} returned HTTP ${upstream.status}. ${detail}`,
      }
    }

    const payload: unknown = await upstream.json()
    const content = extractContent(payload)
    if (content === null) {
      return {
        ok: false,
        status: 502,
        error: 'The provider replied without any message content.',
      }
    }
    return { ok: true, content }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, status: 502, error: `Request to the provider failed: ${message}` }
  }
}
