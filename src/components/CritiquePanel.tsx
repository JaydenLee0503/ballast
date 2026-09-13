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
import { MATERIAL_LIBRARY, type AnalysisResult, type Structure, type Hazard } from '@/engine'
import { buildCritiqueContext } from '@/ai/context.ts'
import { requestCritique } from '@/ai/client.ts'
import type { Critique, UntraceableFigure } from '@/ai/types.ts'
import { BAND_INK_HEX } from '@/lib/palette.ts'

type Status = 'idle' | 'loading' | 'done' | 'error'

export interface CritiquePanelProps {
  result: AnalysisResult
  structure: Structure
  hazard: Hazard
}

/** What the design looked like when the critique was asked for. */
interface RequestedFor {
  structure: Structure
  hazard: Hazard
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
      <p className="text-[0.7rem] leading-relaxed text-ink/55">
        Every number on this page comes from the engine. This panel only
        explains them — and any figure it quotes that cannot be traced back is
        flagged below.
      </p>

      <button
        type="button"
        onClick={ask}
        disabled={status === 'loading'}
        className="w-full rounded-full border-2 border-ink bg-coral py-2 font-display text-sm text-white shadow-[3px_3px_0_0_var(--color-ink)] transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-45"
      >
        {status === 'loading'
          ? 'Thinking…'
          : critique
            ? 'Ask again'
            : 'Ask for a critique'}
      </button>

      {stale && status === 'done' && (
        <p className="slab border-caution-ink/30 bg-caution/10 px-2.5 py-2 text-[0.7rem] leading-relaxed text-caution-ink">
          The design has changed since this critique. The numbers above are
          current; this text is not.
        </p>
      )}

      {status === 'error' && error !== null && (
        <div className="slab border-fail-ink/30 bg-fail/10 px-2.5 py-2 text-[0.7rem] leading-relaxed text-ink/75">
          <span className="font-display text-fail-ink">
            Could not get a critique.{' '}
          </span>
          {error}
        </div>
      )}

      {status === 'done' && critique && (
        <article className="space-y-3">
          {untraceable.length > 0 && (
            <div
              className="rounded-xl border-2 bg-caution/10 px-2.5 py-2 text-[0.7rem] leading-relaxed"
              style={{ borderColor: BAND_INK_HEX.caution, color: BAND_INK_HEX.caution }}
            >
              <span className="font-display">Unverified figures. </span>
              These do not match anything the engine produced, so treat them as
              the model talking, not as results:{' '}
              {untraceable.map((figure) => figure.text).join(', ')}.
            </div>
          )}

          {!parsedAsJson && (
            <p className="text-[0.65rem] text-ink/45">
              The model did not follow the response format, so this is its raw
              reply.
            </p>
          )}

          {critique.verdict !== '' && (
            <p className="font-display text-base leading-snug text-ink">
              {critique.verdict}
            </p>
          )}

          {critique.explanation !== '' && (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink/70">
              {critique.explanation}
            </p>
          )}

          {critique.suggestions.length > 0 && (
            <ol className="space-y-2">
              {critique.suggestions.map((suggestion, index) => (
                <li
                  key={`${index}-${suggestion.change}`}
                  className="slab p-2.5"
                >
                  <p className="font-display text-xs text-ink">
                    {suggestion.change}
                  </p>
                  {suggestion.rationale !== '' && (
                    <p className="mt-1 text-[0.7rem] leading-relaxed text-ink/60">
                      {suggestion.rationale}
                    </p>
                  )}
                  {suggestion.tradeoff !== '' && (
                    <p className="mt-1 text-[0.7rem] leading-relaxed text-caution-ink">
                      Tradeoff: {suggestion.tradeoff}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}

          <p className="text-[0.65rem] leading-relaxed text-ink/45">
            Try a suggestion with the controls — the engine, not the model,
            decides whether it worked.
          </p>
        </article>
      )}
    </div>
  )
}
