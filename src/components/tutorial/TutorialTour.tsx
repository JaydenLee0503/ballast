/**
 * Bo's guided first run.
 *
 * THE SPOTLIGHT. Everything except the control being described is darkened, so
 * there is exactly one bright thing on screen and it is the thing Bo is talking
 * about. The dim is one `box-shadow` with a 9999px spread on the ring itself:
 * a shadow paints *outside* its element, so the hole falls out for free and
 * there is no second element to keep aligned with the first.
 *
 * The dim never swallows a click. The whole overlay is `pointer-events-none`
 * apart from the card, so the highlighted control can still be dragged while it
 * is being explained — which matters, because this is a tool for learning by
 * moving sliders and a tour that disables the sliders teaches nothing. It also
 * means the tour can never trap anybody.
 *
 * POSITIONING IS MEASURED, NOT GUESSED. Each step names a `data-tour` anchor;
 * the ring is placed from that element's live rect and re-measured on scroll and
 * resize, because the panel it lives in scrolls independently of the page. Each
 * step also scrolls its anchor to the middle of that panel, so "the box Bo is
 * talking about" is always actually on screen.
 *
 * If an anchor is missing the ring is not drawn, the screen dims evenly and the
 * card centres itself. A tour is not worth a crash — and steps that name a
 * `tab` make that case rare, because the app opens the tab first.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bo } from './Bo.tsx'
import { stepAt, TUTORIAL_STEPS } from '@/lib/tutorial.ts'
import { useTutorialStore } from '@/store/useTutorial.ts'

/** Breathing room between the highlight and the thing it highlights. */
const RING_PAD_PX = 8
/** How dark everything else goes. Ink, not black: the studio has a warm ground. */
const DIM = 'color-mix(in srgb, var(--color-ink) 62%, transparent)'
/** Big enough to reach the corners of any screen this will run on. */
const DIM_SPREAD_PX = 9999
/**
 * Only the glow and the hole's size animate. Position deliberately does not.
 *
 * The movement between steps is the *scroll* — `scrollIntoView` carries the
 * control to the middle of the panel and the ring tracks it frame by frame. Put
 * a transition on top/left as well and the ring lags behind the very thing it
 * is drawn around for the whole of that scroll, which looks broken in exactly
 * the moment the tour is trying to direct attention.
 */
const RING_TRANSITION = 'width 200ms ease-out, height 200ms ease-out'
/** Roughly the card's own size, for keeping it on screen. */
const CARD_W = 340
const CARD_H = 300
const EDGE_PX = 16

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function anchorElement(anchor: string | null): HTMLElement | null {
  if (anchor === null) return null
  const element = document.querySelector(`[data-tour="${anchor}"]`)
  return element instanceof HTMLElement ? element : null
}

function measure(anchor: string | null): Rect | null {
  if (anchor === null) return null
  const element = anchorElement(anchor)
  if (element === null) return null
  const box = element.getBoundingClientRect()
  // A control scrolled out of its panel measures as a zero-ish box off screen;
  // highlighting that would draw a ring in a corner pointing at nothing.
  if (box.width < 1 || box.height < 1) return null
  return { top: box.top, left: box.left, width: box.width, height: box.height }
}

/**
 * Put the card where the highlighted control is not.
 *
 * Only the horizontal half is chosen from the target — vertically it sits low,
 * where a card is least likely to cover the thing being talked about. Both axes
 * are clamped to the viewport last, so a narrow window degrades to "on screen"
 * rather than to "mostly off the left edge".
 */
function cardPosition(rect: Rect | null): { top: number; left: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (rect === null) {
    return { top: (vh - CARD_H) / 2, left: (vw - CARD_W) / 2 }
  }
  const targetCentre = rect.left + rect.width / 2
  const left = targetCentre > vw / 2 ? EDGE_PX : vw - CARD_W - EDGE_PX
  const top = Math.min(rect.top + rect.height + 12, vh - CARD_H - EDGE_PX)
  return {
    top: Math.max(EDGE_PX, top),
    left: Math.max(EDGE_PX, Math.min(left, vw - CARD_W - EDGE_PX)),
  }
}

export function TutorialTour() {
  const stepIndex = useTutorialStore((state) => state.stepIndex)
  const next = useTutorialStore((state) => state.next)
  const back = useTutorialStore((state) => state.back)
  const close = useTutorialStore((state) => state.close)

  const step = stepIndex === null ? undefined : stepAt(stepIndex)
  const anchor = step?.anchor ?? null

  const [rect, setRect] = useState<Rect | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const remeasure = useCallback(() => setRect(measure(anchor)), [anchor])

  // Layout effect, so the ring is placed in the same frame the step changes and
  // never flashes at the previous step's position.
  //
  // This is the one case the "no setState in an effect" rule is not for: the
  // value being stored is a measurement of the DOM, which by definition does
  // not exist until after the render that produced it. There is nothing to
  // derive it from during render, and no event that carries it. Reading it in
  // a layout effect and storing it is the documented way to do this.
  useLayoutEffect(() => {
    if (stepIndex === null) return
    // eslint-disable-next-line react/set-state-in-effect
    remeasure()
  }, [stepIndex, remeasure])

  // Bring the anchor to the middle of whatever scrolls it. `block: 'center'`
  // rather than 'nearest' on purpose: a control level with the bottom edge is
  // technically visible and practically hidden under Bo's card.
  useEffect(() => {
    if (stepIndex === null) return
    const element = anchorElement(anchor)
    if (element === null) return
    element.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }, [stepIndex, anchor])

  useEffect(() => {
    if (stepIndex === null) return
    // `true` for capture: the panel scrolls, not the window, and a scroll event
    // on an inner element does not bubble.
    window.addEventListener('scroll', remeasure, true)
    window.addEventListener('resize', remeasure)
    return () => {
      window.removeEventListener('scroll', remeasure, true)
      window.removeEventListener('resize', remeasure)
    }
  }, [stepIndex, remeasure])

  useEffect(() => {
    if (stepIndex === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stepIndex, close])

  // Move focus to the card as each step appears, so a screen reader announces
  // the new text and Tab continues from here rather than from the top of the
  // document.
  useEffect(() => {
    if (stepIndex === null) return
    cardRef.current?.focus()
  }, [stepIndex])

  if (stepIndex === null || step === undefined) return null

  const position = cardPosition(rect)
  const isFirst = stepIndex === 0
  const isLast = stepIndex === TUTORIAL_STEPS.length - 1

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {rect === null ? (
        // Nothing to single out: the welcome and sign-off steps, or an anchor
        // that is genuinely not on screen. Dim evenly rather than cutting a
        // hole somewhere arbitrary.
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{ backgroundColor: DIM }}
        />
      ) : (
        <div
          aria-hidden="true"
          className="absolute rounded-xl border-[3px] border-coral motion-reduce:transition-none"
          style={{
            transition: RING_TRANSITION,
            top: rect.top - RING_PAD_PX,
            left: rect.left - RING_PAD_PX,
            width: rect.width + RING_PAD_PX * 2,
            height: rect.height + RING_PAD_PX * 2,
            // Two shadows, and the order matters: box-shadows paint first on
            // top, so the coral glow stays visible over the dim behind it. The
            // second is the spotlight — a shadow paints outside its element, so
            // the bright hole is the ring's own box and cannot drift out of
            // alignment with it.
            boxShadow: [
              '0 0 0 4px color-mix(in srgb, var(--color-coral) 30%, transparent)',
              `0 0 0 ${DIM_SPREAD_PX}px ${DIM}`,
            ].join(', '),
          }}
        />
      )}

      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-label="Getting started with Ballast"
        className="sticker pointer-events-auto absolute w-[340px] p-4 outline-none"
        style={{ top: position.top, left: position.left }}
      >
        <div className="flex items-start gap-3">
          <Bo mood={step.mood} size={54} className="-mt-1 shrink-0" />
          <div className="min-w-0">
            <p className="font-pixel text-[0.62rem] tracking-widest text-ink/45">
              {stepIndex + 1} OF {TUTORIAL_STEPS.length}
            </p>
            <h2 className="font-display text-base leading-tight">{step.title}</h2>
            <p className="mt-1.5 text-[0.8rem] leading-relaxed text-ink/75">
              {step.body}
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={close}
            className="mr-auto font-display text-xs text-ink/45 hover:text-coral"
          >
            {isLast ? 'Close' : 'Skip'}
          </button>
          <button
            type="button"
            onClick={back}
            disabled={isFirst}
            className="rounded-full border-2 border-ink/15 px-3 py-1 font-display text-xs text-ink/60 disabled:opacity-35 enabled:hover:border-ink/40"
          >
            Back
          </button>
          <button
            type="button"
            onClick={next}
            className="rounded-full border-2 border-ink bg-white px-3.5 py-1 font-display text-xs shadow-[3px_3px_0_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
          >
            {isLast ? 'Start building' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
