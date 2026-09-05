/**
 * Browser-side transport for the critique.
 *
 * Thin on purpose: it posts the facts to /api/critique, which is the only
 * component that ever sees the API key (see plugins/critiqueApi.ts). Nothing
 * in this file, and nothing in the bundle it ships in, can reach the provider
 * directly.
 *
 * It also runs the parse and the guard, so every caller gets a critique that
 * has already been checked against the context it was built from. Making that
 * skippable would eventually mean someone skips it.
 */

import { findUntraceableFigures } from './guard.ts'
import { parseCritique } from './parse.ts'
import type { CritiqueContext, CritiqueResult } from './types.ts'

export const CRITIQUE_ENDPOINT = '/api/critique'

interface EndpointSuccess {
  content: string
}

interface EndpointFailure {
  error: string
}

function isFailure(body: unknown): body is EndpointFailure {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as EndpointFailure).error === 'string'
  )
}

function isSuccess(body: unknown): body is EndpointSuccess {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as EndpointSuccess).content === 'string'
  )
}

export async function requestCritique(
  context: CritiqueContext,
  signal?: AbortSignal,
): Promise<CritiqueResult> {
  let response: Response
  try {
    response = await fetch(CRITIQUE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context }),
      ...(signal ? { signal } : {}),
    })
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Could not reach the critique endpoint: ${error.message}`
          : 'Could not reach the critique endpoint.',
    }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return {
      ok: false,
      error: `The critique endpoint returned a non-JSON response (HTTP ${response.status}).`,
    }
  }

  // The endpoint reports its own failures in `error`, including the ones
  // worth acting on: no API key configured, no model configured.
  if (isFailure(body)) return { ok: false, error: body.error }
  if (!response.ok) {
    return { ok: false, error: `The critique endpoint failed (HTTP ${response.status}).` }
  }
  if (!isSuccess(body)) {
    return { ok: false, error: 'The critique endpoint returned an unexpected shape.' }
  }

  const { critique, parsedAsJson } = parseCritique(body.content)
  return {
    ok: true,
    critique,
    parsedAsJson,
    untraceable: findUntraceableFigures(critique, context),
  }
}
