/**
 * Human names for the envelope systems.
 *
 * Copy only. The systems themselves, their glazing ratios and everything the
 * engine charges for them live in `engine/constants.ts` — this file exists so
 * that "curtain-wall" is written as "Curtain wall" in exactly one place rather
 * than in the controls, the hover card and whatever comes next.
 *
 * The blurbs say what the choice *does*, in the order a student cares about:
 * how it looks, then what it costs them. They are hand-written rather than
 * generated from `FACADE`, because "light, and expensive" is a reading of
 * three numbers and not one of them.
 */

import type { FacadeSystem } from '@/engine'

export const FACADE_LABEL: Readonly<Record<FacadeSystem, string>> = {
  exposed: 'Bare frame',
  punched: 'Punched windows',
  ribbon: 'Ribbon glazing',
  'curtain-wall': 'Curtain wall',
}

/** One short line each, for the control that picks between them. */
export const FACADE_BLURB: Readonly<Record<FacadeSystem, string>> = {
  exposed: 'No walls at all. Free, weightless, and not a building anyone could use — it is here so you can see what the skin was costing.',
  punched: 'Heavy concrete or brick with windows cut into it. The cheapest real envelope, and the heaviest, which helps it stay put.',
  ribbon: 'Bands of glass between solid strips. Middle of the road on every count.',
  'curtain-wall': 'All glass, floor to ceiling. The most carbon and the most money — and so light that the tower gets easier to tip over.',
}
