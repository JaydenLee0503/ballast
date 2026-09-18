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

import type { ServerResponse } from 'node:http'

export interface AiProviderOptions {
  apiKey: string | undefined
  model: string | undefined
  baseUrl: string | undefined
}

export const DEFAULT_BASE_URL = 'https://api.featherless.ai/v1'
export const REQUEST_TIMEOUT_MS = 90_000

/**
 * One retry, and only for a failure the provider itself called transient.
 *
 * Featherless answers roughly one request in eight with a `server_error` /
 * `no_response` body — an upstream completion service that did not come back —
 * and the next attempt almost always succeeds. Without a retry that is a
 * one-in-eight chance of a student pressing the button and being told nothing
 * was built, which during a demo is the whole demo.
 */
export const MAX_ATTEMPTS = 2

/**
 * A retry is only worth starting if there is time to finish it.
 *
 * Measured round trips on a 72B model ran 11 s, 17 s and 34 s, and the Vercel
 * function is capped (`vercel.json`) at 60 s. So a second attempt is started
 * only when the first failed inside this budget: 25 + 34 = 59 s, which stays
 * inside the cap even on the slowest reply seen. A transient failure normally
 * comes back in a second or two, so in practice the budget is never the reason
 * a retry is skipped — it is there so that a *slow* failure cannot turn into a
 * platform timeout, which reports far worse than an honest error.
 */
export const RETRY_BUDGET_MS = 25_000

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(body))
}

/**
 * Typed structurally rather than as Vite's `Connect.IncomingMessage`, so that
 * NOTHING on the path from a serverless function to the provider imports Vite
 * — not even for a type. A type-only import should be erased before anything
 * tries to resolve it, but "should be" is a bet on another tool's compiler, and
 * losing it means a bundler pulling a dev server into a 60-second function.
 * A Node request stream satisfies this, so the Vite transport still passes its
 * own object straight in.
 */
export async function readJsonBody(
  request: AsyncIterable<Buffer | string>,
): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Split a body into the JSON values it actually contains.
 *
 * WHY THIS IS NOT `JSON.parse`. Featherless intermittently answers an
 * OpenAI-compatible completion request with HTTP 200 and *two* concatenated
 * objects: a stub `chat.completion` with zero tokens, immediately followed by
 * `{"error":{"message":"No successful response received from completion
 * service","type":"server_error","code":"no_response"}}`. A single parse throws
 * "Unexpected non-whitespace character after JSON at position 1691", which
 * tells whoever is reading it nothing at all, and buries the one sentence that
 * explains what went wrong.
 *
 * So the body is scanned for balanced top-level values rather than assumed to
 * be one. Strings and escapes are tracked, because a brace inside a quoted
 * string is not a nesting level — and the model's own reply is a JSON string
 * full of braces.
 */
export function splitJsonValues(text: string): unknown[] {
  const values: unknown[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{' || char === '[') {
      if (depth === 0) start = i
      depth += 1
      continue
    }
    if (char === '}' || char === ']') {
      depth -= 1
      if (depth === 0 && start >= 0) {
        try {
          values.push(JSON.parse(text.slice(start, i + 1)))
        } catch {
          // A value that does not parse on its own is not a value. Skipped
          // rather than thrown on, so one malformed tail cannot hide a good
          // payload that arrived ahead of it.
        }
        start = -1
      }
    }
  }
  return values
}

/** `{ error: { message } }`, the shape both OpenAI and Featherless use. */
function errorMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const error = (value as { error?: unknown }).error
  if (typeof error === 'string') return error
  if (typeof error !== 'object' || error === null) return null
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? message : null
}

type BodyOutcome =
  | { ok: true; payload: unknown }
  | { ok: false; detail: string; transient: boolean }

/**
 * The payload a body carries, or the reason it carries none.
 *
 * An error object anywhere in the body wins over a completion that arrived
 * beside it, because that is exactly the case above: the stub completion is
 * empty and the error is the only true thing in the response.
 */
function readBody(text: string): BodyOutcome {
  const values = splitJsonValues(text)

  for (const value of values) {
    const message = errorMessage(value)
    if (message !== null) {
      return {
        ok: false,
        detail: message,
        // The provider's own classification, not a guess from the wording.
        transient: /server_error|no_response|timeout|overload/i.test(text),
      }
    }
  }

  const first = values[0]
  if (first === undefined) {
    return {
      ok: false,
      // The raw text, clipped. Whoever reads this needs to see what arrived.
      detail: `the body held no JSON value: ${text.slice(0, 200)}`,
      transient: false,
    }
  }
  return { ok: true, payload: first }
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
  // Phrased for both transports. Locally the fix is .env and a restart; on a
  // host it is the project's environment variables and a redeploy. Naming only
  // one of them sends whoever is reading it to the wrong place, and this string
  // is the first thing anybody sees when a deploy is misconfigured.
  if (!options.apiKey) {
    return 'FEATHERLESS_API_KEY is not set. Add it to .env and restart the dev server, or to your host\'s environment variables and redeploy.'
  }
  if (!options.model) {
    return 'FEATHERLESS_MODEL is not set. Add the exact model id from the Featherless catalogue to .env and restart the dev server, or to your host\'s environment variables and redeploy.'
  }
  return null
}

/**
 * A status code and a JSON body, with no opinion about how they are sent.
 *
 * What a route decides, separated from how the answer travels. The two
 * transports — the Vite middleware in dev, the Vercel function in production —
 * both turn one of these into a response, so the decisions themselves exist
 * once.
 */
export interface RouteReply {
  status: number
  body: unknown
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

/** One attempt. `transient` says whether trying again is worth anything. */
async function attempt(
  call: ProviderCall,
  baseUrl: string,
): Promise<ProviderOutcome & { transient?: boolean }> {
  const { options } = call
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

    const text = await upstream.text()
    const body = readBody(text)

    if (!upstream.ok) {
      // The provider's own sentence where it gave one, the raw text where it
      // did not. "model not found" and "out of credit" are things a developer
      // has to be able to read.
      const detail = body.ok ? text.slice(0, 500) : body.detail
      return {
        ok: false,
        status: 502,
        error: `${options.model} returned HTTP ${upstream.status}. ${detail}`,
        transient: upstream.status >= 500,
      }
    }

    // A 200 is not a success on its own: this is where the two-object body
    // lands, HTTP 200 with an error as its second value.
    if (!body.ok) {
      return {
        ok: false,
        status: 502,
        error: `${options.model} failed: ${body.detail}`,
        transient: body.transient,
      }
    }

    const content = extractContent(body.payload)
    if (content === null) {
      return {
        ok: false,
        status: 502,
        error: 'The provider replied without any message content.',
        transient: true,
      }
    }
    return { ok: true, content }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: 502,
      error: `Request to the provider failed: ${message}`,
      // A timeout or a dropped socket is worth one more go; anything else
      // here is a programming error and repeating it changes nothing.
      transient: error instanceof Error && error.name === 'TimeoutError',
    }
  }
}

export async function callProvider(call: ProviderCall): Promise<ProviderOutcome> {
  const baseUrl = (call.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const started = Date.now()
  let last: ProviderOutcome = {
    ok: false,
    status: 502,
    error: 'The provider was never called.',
  }

  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    const outcome = await attempt(call, baseUrl)
    if (outcome.ok) return outcome
    last = { ok: false, status: outcome.status, error: outcome.error }
    if (outcome.transient !== true) break
    if (Date.now() - started > RETRY_BUDGET_MS) break
  }
  return last
}
