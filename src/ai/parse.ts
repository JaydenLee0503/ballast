/**
 * Tolerant parsing of the model's reply.
 *
 * A 70B-class open-weight model asked for "JSON and nothing else" will
 * usually comply and will sometimes wrap it in a code fence, prefix it with
 * "Here is the critique:", or trail off mid-object. None of that should show
 * the student an error page, so this degrades in stages: strict JSON, then
 * the first balanced object in the text, then the raw prose as an
 * explanation with no suggestions.
 *
 * Pure and import-free apart from types, for the same reason as prompt.ts.
 */

import type { Critique, CritiqueSuggestion } from './types.ts'

/**
 * Finds the first balanced {...} run, ignoring braces inside strings. A
 * regex cannot do this correctly and the failure mode -- truncating at a
 * brace inside a sentence -- produces confusing half-parses.
 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asSuggestions(value: unknown): CritiqueSuggestion[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): CritiqueSuggestion[] => {
    if (typeof entry !== 'object' || entry === null) return []
    const record = entry as Record<string, unknown>
    const change = asString(record['change'])
    // A suggestion with no actionable change is noise; drop it rather than
    // rendering an empty card.
    if (change === '') return []
    return [
      {
        change,
        rationale: asString(record['rationale']),
        tradeoff: asString(record['tradeoff']),
      },
    ]
  })
}

export interface ParsedCritique {
  critique: Critique
  /** False when we fell back to treating the whole reply as prose. */
  parsedAsJson: boolean
}

export function parseCritique(raw: string): ParsedCritique {
  const text = raw.trim()
  const candidate = extractJsonObject(text)

  if (candidate !== null) {
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (typeof parsed === 'object' && parsed !== null) {
        const record = parsed as Record<string, unknown>
        const verdict = asString(record['verdict'])
        const explanation = asString(record['explanation'])
        const suggestions = asSuggestions(record['suggestions'])
        // Require at least one of the prose fields. An object with the right
        // shape but nothing in it is worse than showing the raw reply.
        if (verdict !== '' || explanation !== '') {
          return {
            critique: { verdict, explanation, suggestions },
            parsedAsJson: true,
          }
        }
      }
    } catch {
      // Fall through to the prose fallback below.
    }
  }

  return {
    critique: { verdict: '', explanation: text, suggestions: [] },
    parsedAsJson: false,
  }
}
