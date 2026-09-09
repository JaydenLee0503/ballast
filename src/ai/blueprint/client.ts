/**
 * Browser-side transport for a blueprint.
 *
 * Thin, for the same reason `ai/client.ts` is: /api/blueprint is the only place
 * the provider key exists (see plugins/blueprintApi.ts), and nothing in the
 * bundle this ships in can reach the provider directly.
 *
 * It also runs the parse, so no caller can hold an unvalidated proposal. A
 * `Blueprint` that reached a store action without going through `parseBlueprint`
 * would be a design with an unchecked material id in it.
 */

import { buildBlueprintCatalogue } from './catalogue.ts'
import { BlueprintParseError, parseBlueprint, type Blueprint } from './parse.ts'
import type { BlueprintRequestBody } from './types.ts'

export const BLUEPRINT_ENDPOINT = '/api/blueprint'

export type BlueprintResult =
  | { ok: true; blueprint: Blueprint }
  | { ok: false; error: string }

interface EndpointSuccess {
  content: string
}

function isFailure(body: unknown): body is { error: string } {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { error?: unknown }).error === 'string'
  )
}

function isSuccess(body: unknown): body is EndpointSuccess {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as EndpointSuccess).content === 'string'
  )
}

export async function requestBlueprint(
  description: string,
  signal?: AbortSignal,
): Promise<BlueprintResult> {
  const payload: BlueprintRequestBody = {
    description,
    catalogue: buildBlueprintCatalogue(),
  }

  let response: Response
  try {
    response = await fetch(BLUEPRINT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      ...(signal ? { signal } : {}),
    })
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Could not reach the blueprint endpoint: ${error.message}`
          : 'Could not reach the blueprint endpoint.',
    }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return {
      ok: false,
      error: `The blueprint endpoint returned a non-JSON response (HTTP ${response.status}).`,
    }
  }

  // The endpoint reports its own failures in `error`, including the two worth
  // acting on: no API key configured, no model configured.
  if (isFailure(body)) return { ok: false, error: body.error }
  if (!response.ok) {
    return { ok: false, error: `The blueprint endpoint failed (HTTP ${response.status}).` }
  }
  if (!isSuccess(body)) {
    return { ok: false, error: 'The blueprint endpoint returned an unexpected shape.' }
  }

  try {
    return { ok: true, blueprint: parseBlueprint(body.content, description) }
  } catch (error) {
    if (error instanceof BlueprintParseError) {
      return { ok: false, error: `The model's design could not be used: ${error.message}` }
    }
    throw error
  }
}
