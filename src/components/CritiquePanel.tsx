/**
 * The AI layer's entire footprint on screen.
 *
 * It reads an AnalysisResult and returns prose. It produces no numbers, and
 * the ones it quotes are checked: `requestCritique` runs every reply through
 * `findUntraceableFigures`, and anything that does not trace back to the
 * engine context is shown to the student as an explicit caution rather than
 * being quietly rendered as fact.
 *
 * Critique is requested on a button press, never on a slider change. Cost is
 * part of that, but the bigger reason is that a paragraph rewriting itself
 * while you drag is unreadable. When the design moves on, the critique is
 * marked stale instead of being silently wrong.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { MATERIAL_LIBRARY, type AnalysisResult, type Structure, type WindHazard } from '@/engine'
import { buildCritiqueContext } from '@/ai/context.ts'
import { requestCritique } from '@/ai/client.ts'
import type { Critique, UntraceableFigure } from '@/ai/types.ts'
import { BAND_HEX } from '@/lib/palette.ts'

type Status = 'idle' | 'loading' | 'done' | 'error'

export interface CritiquePanelProps {
  result: AnalysisResult
  structure: Structure
  hazard: WindHazard
}

/** What the design looked like when the critique was asked for. */
interface RequestedFor {
  structure: Structure
  hazard: WindHazard
}

export function CritiquePanel({ result, structure, hazard }: CritiquePanelProps) {
  const [status, setStatus] = useState<Status>('idle')
  const [critique, setCritique] = useState<Critique | null>(null)
  const [untraceable, setUntraceable] = useState<UntraceableFigure[]>([])
  const [parsedAsJson, setParsedAsJson] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestedFor, setRequestedFor] = useState<RequestedFor | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const ask = useCallback(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStatus('loading')
    setError(null)
    setRequestedFor({ structure, hazard })

    const context = buildCritiqueContext(result, structure, hazard, MATERIAL_LIBRARY)

    void requestCritique(context, controller.signal).then((outcome) => {
      if (controller.signal.aborted) return
      if (!outcome.ok) {
        setStatus('error')
        setError(outcome.error)
        return
      }
      setCritique(outcome.critique)
      setUntraceable(outcome.untraceable)
      setParsedAsJson(outcome.parsedAsJson)
      setStatus('done')
    })
  }, [result, structure, hazard])

  // Object identity is the comparison, which works because every store action
  // replaces the structure rather than mutating it.
  const stale =
    requestedFor !== null &&
    (requestedFor.structure !== structure || requestedFor.hazard !== hazard)

  return (
    <div className="space-y-3">
      <p className="text-[0.7rem] leading-relaxed text-neutral-500">
        Every number on this page comes from the engine. This panel only
        explains them — and any figure it quotes that cannot be traced back is
        flagged below.
      </p>

      <button
        type="button"
        onClick={ask}
        disabled={status === 'loading'}
        className="w-full rounded border border-wind/60 bg-wind/10 py-2 text-xs text-neutral-100 hover:bg-wind/20 disabled:opacity-40"
      >
        {status === 'loading'
          ? 'Thinking…'
          : critique
            ? 'Ask again'
            : 'Ask for a critique'}
      </button>

      {stale && status === 'done' && (
        <p className="rounded border border-caution/40 px-2 py-1.5 text-[0.7rem] text-caution">
          The design has changed since this critique. The numbers above are
          current; this text is not.
        </p>
      )}

      {status === 'error' && error !== null && (
        <div className="rounded border border-fail/50 px-2 py-1.5 text-[0.7rem] leading-relaxed text-neutral-300">
          <span className="font-medium text-fail">Could not get a critique. </span>
          {error}
        </div>
      )}

      {status === 'done' && critique && (
        <article className="space-y-3">
          {untraceable.length > 0 && (
            <div
              className="rounded border px-2 py-1.5 text-[0.7rem] leading-relaxed"
              style={{ borderColor: BAND_HEX.caution, color: BAND_HEX.caution }}
            >
              <span className="font-medium">Unverified figures. </span>
              These do not match anything the engine produced, so treat them as
              the model talking, not as results:{' '}
              {untraceable.map((figure) => figure.text).join(', ')}.
            </div>
          )}

          {!parsedAsJson && (
            <p className="text-[0.65rem] text-neutral-600">
              The model did not follow the response format, so this is its raw
              reply.
            </p>
          )}

          {critique.verdict !== '' && (
            <p className="text-sm leading-snug text-neutral-100">
              {critique.verdict}
            </p>
          )}

          {critique.explanation !== '' && (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-neutral-400">
              {critique.explanation}
            </p>
          )}

          {critique.suggestions.length > 0 && (
            <ol className="space-y-2">
              {critique.suggestions.map((suggestion, index) => (
                <li
                  key={`${index}-${suggestion.change}`}
                  className="rounded border border-neutral-800 bg-neutral-900/40 p-2.5"
                >
                  <p className="text-xs font-medium text-neutral-200">
                    {suggestion.change}
                  </p>
                  {suggestion.rationale !== '' && (
                    <p className="mt-1 text-[0.7rem] leading-relaxed text-neutral-500">
                      {suggestion.rationale}
                    </p>
                  )}
                  {suggestion.tradeoff !== '' && (
                    <p className="mt-1 text-[0.7rem] leading-relaxed text-caution/70">
                      Tradeoff: {suggestion.tradeoff}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}

          <p className="text-[0.65rem] text-neutral-600">
            Try a suggestion with the controls — the engine, not the model,
            decides whether it worked.
          </p>
        </article>
      )}
    </div>
  )
}
