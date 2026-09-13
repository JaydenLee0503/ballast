/**
 * Human names for the three hazards. Copy and colour only — no arithmetic.
 *
 * The same role `lib/facade.ts` plays for envelopes: one place for the words,
 * so the chip, the header, the saved-design list, the simulation overlay and
 * the critique all call an earthquake the same thing. A second copy of these
 * strings is a second thing to drift.
 *
 * The blurbs name the CONSEQUENCE rather than the mechanism, because the
 * consequence is what a student is choosing between. "It pushes on everything
 * it can reach" says more about why a flood is different from a gale than
 * "hydrostatic pressure" does, and the engine's warnings carry the precision.
 */

import type { Hazard } from '@/engine'

export const HAZARD_LABEL: Readonly<Record<Hazard['kind'], string>> = {
  wind: 'Storm',
  seismic: 'Earthquake',
  flood: 'Flood',
}

/** What the event is called in a sentence, lower case: "during the storm". */
export const HAZARD_NOUN: Readonly<Record<Hazard['kind'], string>> = {
  wind: 'storm',
  seismic: 'earthquake',
  flood: 'flood',
}

export const HAZARD_BLURB: Readonly<Record<Hazard['kind'], string>> = {
  wind: 'Pushes hardest at the top, where the air moves fastest. Wide faces catch more of it.',
  seismic:
    'Shakes the ground, and your building has to drag its own weight along. The heavier it is, the harder it is thrown.',
  flood:
    'Leans on the bottom few metres and tries to float the rest. Light buildings are the ones that lift.',
}

/**
 * One line naming what the hazard actually does to a building, used where
 * there is room for a sentence of why rather than just a label.
 */
export const HAZARD_LESSON: Readonly<Record<Hazard['kind'], string>> = {
  wind: 'Load grows with height and with the face you present. Be narrow, be stiff, be heavy.',
  seismic:
    'Load grows with mass. Be light, be ductile, be even — one weak storey costs the whole tower.',
  flood:
    'Load grows with the square of depth, and buoyancy grows with volume. Be heavy, be anchored, let it in.',
}

/**
 * Arrow and overlay colour per hazard.
 *
 * NOT UTILISATION COLOURS. `lib/palette.ts` owns green/amber/red and those mean
 * "how hard is this working"; these mean "what is hitting it", and the two must
 * stay separable at a glance. Kept here rather than in the palette for the same
 * reason `WIND_HEX` originally was: it is scenery about the event, not a
 * reading of the building.
 */
export const HAZARD_HEX: Readonly<Record<Hazard['kind'], string>> = {
  wind: '#60a5fa',
  seismic: '#f97316',
  flood: '#0ea5e9',
}

/**
 * The hazard in a handful of words, with its numbers — for a list row, a
 * header chip or a tooltip.
 *
 * Formatting only: every figure is a field of the hazard the student set, not
 * anything derived. Rounded for display the way `lib/format.ts` rounds.
 */
export function hazardSummary(hazard: Hazard): string {
  switch (hazard.kind) {
    case 'wind':
      return `${Math.round(hazard.gustSpeed_kmh)} km/h gust`
    case 'seismic':
      return `Ss ${hazard.Ss_g.toFixed(2)}g · site ${hazard.siteClass}`
    case 'flood':
      return `${hazard.depth_m.toFixed(1)} m deep · ${hazard.velocity_ms.toFixed(1)} m/s`
  }
}

/** The clause family each hazard is built from, for the studio's eyebrow. */
export const HAZARD_PROVENANCE: Readonly<Record<Hazard['kind'], string>> = {
  wind: 'ASCE 7 CH. 26-27',
  seismic: 'ASCE 7 CH. 11-12',
  flood: 'ASCE 7 CH. 5',
}
