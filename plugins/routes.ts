/**
 * The two AI routes, minus HTTP.
 *
 * Every decision either route makes lives here: is the provider configured, is
 * the body the right shape, how many tokens may the reply use, what does the
 * provider's failure look like to a caller. What is deliberately absent is any
 * notion of how a request arrives or an answer leaves.
 *
 * THAT IS WHY THIS FILE EXISTS SEPARATELY. There are two transports — the Vite
 * middleware in `critiqueApi.ts` / `blueprintApi.ts` for dev and preview, and
 * the Vercel functions in `api/` for production — and the second must not drag
 * the first's dependencies along with it. Nothing reachable from this module
 * imports Vite, not even for a type: a type-only import ought to be erased
 * before any bundler tries to resolve it, but that is a bet on another tool's
 * compiler, and losing it means a dev server being pulled into a serverless
 * function. `routeDeps.test.ts` asserts the property rather than
 * trusting this comment.
 *
 * The message builders it calls (`src/ai/prompt.ts`, `src/ai/blueprint/
 * prompt.ts`) are pure and already shared with the browser and the tests, so
 * adding a third caller costs nothing.
 */

import { buildMessages } from '../src/ai/prompt.ts'
import type { CritiqueContext } from '../src/ai/types.ts'
import { buildBlueprintMessages } from '../src/ai/blueprint/prompt.ts'
import type { BlueprintCatalogue } from '../src/ai/blueprint/types.ts'
import {
  callProvider,
  missingConfig,
  type AiProviderOptions,
  type RouteReply,
} from './aiProvider.ts'

/** Enough for a verdict, a paragraph and three suggestions, and no more. */
const CRITIQUE_MAX_TOKENS = 900
/** Low but not zero: explanation should be steady, not robotic. */
const CRITIQUE_TEMPERATURE = 0.4

/** A name, a dozen numbers, two short sentences and a list of ids. */
const BLUEPRINT_MAX_TOKENS = 700
const BLUEPRINT_TEMPERATURE = 0.2

/** How much free text a blueprint request may carry. A wish, not a brief. */
export const MAX_DESCRIPTION_LENGTH = 400

function hasContext(body: unknown): body is { context: CritiqueContext } {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { context?: unknown }).context === 'object' &&
    (body as { context?: unknown }).context !== null
  )
}

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
 * Takes an already-parsed body, because the two transports read one very
 * differently — a Node stream in Vite, `await request.json()` on Vercel — and
 * that is the only thing they should disagree about.
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
    temperature: CRITIQUE_TEMPERATURE,
    maxTokens: CRITIQUE_MAX_TOKENS,
  })
  if (!outcome.ok) return { status: outcome.status, body: { error: outcome.error } }
  return { status: 200, body: { content: outcome.content } }
}

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
    temperature: BLUEPRINT_TEMPERATURE,
    maxTokens: BLUEPRINT_MAX_TOKENS,
  })
  if (!outcome.ok) return { status: outcome.status, body: { error: outcome.error } }
  return { status: 200, body: { content: outcome.content } }
}
