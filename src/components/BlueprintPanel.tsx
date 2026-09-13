/**
 * "Describe a building" — the AI's second job on screen.
 *
 * The critique panel takes engine output and returns prose. This one takes a
 * sentence and returns *input*: the storeys, the plan, the material, the system,
 * the skin and the foundation that a student could have set by hand. It writes
 * them into the store through `applyBlueprint`, and from that moment there is
 * nothing AI-shaped about the design — every control below edits it and every
 * number beside it is the engine's, computed the same way as always.
 *
 * WHAT THE STUDENT IS TOLD. Three things come back with the design and all three
 * are shown, because a generated building is the easiest thing in the app to
 * over-trust:
 *
 *   - what was pulled into range, so "I asked for 40 floors" does not silently
 *     become 24;
 *   - what the engine cannot represent about the thing they asked for, in the
 *     app's own fixed words rather than the model's, and including the caveats
 *     the request implies whether or not the model admitted them;
 *   - any figure in the model's prose that traces back to nothing, via the same
 *     guard the critique uses. A proposal that predicts a safety factor is
 *     flagged, not read as a result.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { requestBlueprint } from '@/ai/blueprint/client.ts'
import type { Blueprint } from '@/ai/blueprint/parse.ts'
import { BAND_INK_HEX } from '@/lib/palette.ts'
import { useDesignStore } from '@/store/design.ts'

type Status = 'idle' | 'loading' | 'done' | 'error'

/**
 * Starters. Two of them are things the engine models honestly and two are not,
 * on purpose: the fastest way to learn what a teaching model does not do is to
 * ask it for an arena and read what comes back with it.
 */
const EXAMPLES: readonly string[] = [
  'A primary school',
  'An arena',
  'A tall hotel by the sea',
  'A round observation tower',
]

const MAX_LENGTH = 400

export function BlueprintPanel() {
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null)
  const [error, setError] = useState<string | null>(null)
  const applyBlueprint = useDesignStore((state) => state.applyBlueprint)

  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const build = useCallback(
    (text: string) => {
      const asked = text.trim()
      if (asked === '') return
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setStatus('loading')
      setError(null)

      void requestBlueprint(asked, controller.signal).then((outcome) => {
        if (controller.signal.aborted) return
        if (!outcome.ok) {
          setStatus('error')
          setError(outcome.error)
          return
        }
        // Applied straight away rather than offered for confirmation: this is a
        // starting point, the engine scores it in the same frame, and the way to
        // judge a starting point is to look at it.
        setBlueprint(outcome.blueprint)
        applyBlueprint(outcome.blueprint)
        setStatus('done')
      })
    },
    [applyBlueprint],
  )

  const loading = status === 'loading'

  return (
    <section data-tour="describe" className="sticker space-y-3 p-3">
      <div>
        <h3 className="font-pixel text-[0.7rem] uppercase tracking-widest text-ink/45">
          Describe a building
        </h3>
        <p className="mt-1 text-[0.65rem] leading-relaxed text-ink/50">
          Say what you want and it sets the controls for you. It only chooses the
          starting point — the engine works out whether it stands up.
        </p>
      </div>

      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value.slice(0, MAX_LENGTH))}
        onKeyDown={(event) => {
          // Enter builds, Shift+Enter is a newline. A one-line wish is the
          // common case and reaching for the mouse for it is a nuisance.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            build(description)
          }
        }}
        rows={2}
        placeholder="An arena. A timber library. A tower block on a windy hill."
        className="w-full resize-none rounded-lg border-2 border-ink/15 bg-paper px-2 py-1.5 text-xs leading-relaxed text-ink placeholder:text-ink/35 focus:border-ink focus:outline-none"
      />

      <div className="flex flex-wrap gap-1">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => {
              setDescription(example)
              build(example)
            }}
            disabled={loading}
            className="rounded-full border-2 border-ink/15 bg-paper px-2 py-0.5 text-[0.65rem] text-ink/60 hover:border-ink/40 hover:text-ink disabled:opacity-40"
          >
            {example}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => build(description)}
        disabled={loading || description.trim() === ''}
        className="w-full rounded-full border-2 border-ink bg-coral py-2 font-display text-sm text-white shadow-[3px_3px_0_0_var(--color-ink)] transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-45"
      >
        {loading ? 'Drawing it…' : 'Build it'}
      </button>

      {status === 'error' && error !== null && (
        <div className="slab border-fail-ink/30 bg-fail/10 px-2.5 py-2 text-[0.7rem] leading-relaxed text-ink/75">
          <span className="font-display text-fail-ink">Nothing was built. </span>
          {error}
        </div>
      )}

      {status === 'done' && blueprint !== null && (
        <div className="space-y-2">
          <p className="font-display text-sm leading-snug text-ink">
            {blueprint.name}
          </p>
          {blueprint.interpretation !== '' && (
            <p className="text-[0.7rem] leading-relaxed text-ink/70">
              {blueprint.interpretation}
            </p>
          )}
          {blueprint.notes !== '' && (
            <p className="text-[0.7rem] leading-relaxed text-ink/55">
              {blueprint.notes}
            </p>
          )}

          {blueprint.unverified.length > 0 && (
            <div
              className="rounded-xl border-2 bg-caution/10 px-2.5 py-2 text-[0.7rem] leading-relaxed"
              style={{ borderColor: BAND_INK_HEX.caution, color: BAND_INK_HEX.caution }}
            >
              <span className="font-display">Unverified figures. </span>
              Nothing has been analysed yet, so these are the model talking, not
              results: {blueprint.unverified.map((figure) => figure.text).join(', ')}.
              The dials above are the real answer.
            </div>
          )}

          {blueprint.adjustments.length > 0 && (
            <ul className="slab space-y-1 px-2.5 py-2 text-[0.7rem] leading-relaxed text-ink/60">
              {blueprint.adjustments.map((adjustment) => (
                <li key={adjustment}>{adjustment}</li>
              ))}
            </ul>
          )}

          {blueprint.caveats.length > 0 && (
            <div className="slab border-caution-ink/25 bg-caution/10 px-2.5 py-2">
              <p className="font-display text-[0.7rem] text-caution-ink">
                What this is not
              </p>
              <ul className="mt-1 space-y-1.5 text-[0.7rem] leading-relaxed text-caution-ink">
                {blueprint.caveats.map((caveat) => (
                  <li key={caveat}>{caveat}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[0.65rem] leading-relaxed text-ink/45">
            Now change it. Floors, size, material and skin are all yours below,
            and the dials update as you go.
          </p>
        </div>
      )}
    </section>
  )
}
