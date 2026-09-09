/**
 * The contract for "describe a building and get one".
 *
 * WHAT THIS LAYER IS ALLOWED TO DO. The model here writes *input*, not output:
 * the fields it fills in are the same ones the archetype table in
 * `lib/typology.ts` fills in, and the same ones a student could set by hand on
 * the controls. `analyze()` cannot tell a blueprint apart from a hand-built
 * design, and every number the student then reads — safety factor, drift,
 * carbon, cost — is computed by the engine from that input, exactly as before.
 * So this does not bend the one rule. A blueprint is a typing shortcut for the
 * sliders, and the prompt, the parser and the guard all exist to keep it one.
 *
 * WHAT IT IS NOT ALLOWED TO DO. It may not state or predict a result. A
 * proposal that says "this will reach a safety factor of 2.1" is producing a
 * number the engine has not produced, which is the failure this codebase is
 * built to refuse — so the prose fields go through `ai/guard.ts` against the
 * blueprint's own inputs, and anything else numeric is flagged on screen.
 *
 * This module has NO imports, for the same reason `ai/types.ts` has none: the
 * prompt builder is bundled into `vite.config.ts` so the dev-server middleware
 * can build prompts without shipping the API key to the browser, and anything
 * it reaches for has to resolve in that context too.
 */

/** One material the model may choose, with the systems it can actually form. */
export interface BlueprintMaterialOption {
  id: string
  name: string
  structuralClass: string
  /** From `BUILDABLE_SYSTEMS`: rammed earth cannot be a moment frame. */
  buildableSystems: string[]
}

export interface BlueprintRange {
  min: number
  max: number
}

/**
 * The editing bounds, sent to the model so it proposes a design the controls
 * can still express. They are `lib/limits.ts` values; the parser clamps to the
 * same numbers afterwards, because a prompt is a request and not a guarantee.
 */
export interface BlueprintLimits {
  storeyCount: BlueprintRange
  storeyHeight_m: BlueprintRange
  planWidth_m: BlueprintRange
  taper: BlueprintRange
  embedmentDepth_m: BlueprintRange
  anchorCapacity_kN: BlueprintRange
}

export interface BlueprintNamedOption {
  id: string
  name: string
  description: string
}

/**
 * Everything the model is allowed to pick from. Built in the browser from the
 * real material library and the real limits (see catalogue.ts), then sent with
 * the request — the same shape of arrangement as `CritiqueContext`, and for the
 * same reason: the prompt module stays free of engine imports.
 */
export interface BlueprintCatalogue {
  materials: BlueprintMaterialOption[]
  lateralSystems: string[]
  facades: BlueprintNamedOption[]
  /** Footprints. A real engine input, not a drawing option — see `plan.ts`. */
  planShapes: BlueprintNamedOption[]
  foundations: string[]
  exposures: BlueprintNamedOption[]
  /** Declared building kinds. Anything else must be proposed as 'custom'. */
  typologies: BlueprintNamedOption[]
  limits: BlueprintLimits
  /** The caveat ids the model may cite, with the sentence each one stands for. */
  caveats: BlueprintNamedOption[]
}

/** What goes over the wire to /api/blueprint. */
export interface BlueprintRequestBody {
  /** What the student typed. Free text, e.g. "an arena". */
  description: string
  catalogue: BlueprintCatalogue
}

/**
 * The honest limits of the model, as fixed sentences with fixed ids.
 *
 * WHY THE TEXT IS OURS AND NOT THE MODEL'S. A student who asks for an arena
 * gets a stack of boxes, because that is all this engine has: `lib/typology.ts`
 * refuses a stadium archetype for exactly this reason. Letting the model write
 * its own disclaimer would let it write a *reassuring* one, and an
 * understated caveat is worse than none — it is the same failure as an invented
 * number, arriving as prose. So the model may only cite an id from this table,
 * the app renders the sentence, and `requiredCaveats()` in parse.ts adds the
 * ones the request obviously implies whether the model mentioned them or not.
 *
 * Every entry states something the engine genuinely does not do. If one of
 * these stops being true, the fix is a load case in `src/engine/` with its own
 * citation and its own test, and then the entry goes away.
 */
export const BLUEPRINT_CAVEATS: readonly BlueprintNamedOption[] = [
  {
    id: 'not-a-building',
    name: 'Not a building',
    description:
      'This is not a building. The engine stacks storeys on a foundation and pushes wind sideways at them; a bridge, mast, dam or tunnel has a load path it does not represent at all, so treat what you see as a shape, not as an analysis.',
  },
  {
    id: 'long-span-roof',
    name: 'No long-span roof',
    description:
      'The engine has no long-span element. An arena, stadium, hangar or dome roof is the thing that would actually govern such a building, and here it is not modelled at all — the top of the stack is another storey box.',
  },
  {
    id: 'uplift',
    name: 'No wind uplift',
    description:
      'Wind is resolved as horizontal pressure on the windward face only. There is no uplift case, so a wide light roof cannot be shown lifting off, which is the failure large single-volume buildings actually suffer.',
  },
  {
    id: 'cantilever',
    name: 'No cantilevers or tiers',
    description:
      'Every storey sits fully on the one below it. Cantilevers, seating tiers, overhangs and transfer structures are not modelled.',
  },
  {
    id: 'curved-plan',
    name: 'Rectangular plans only',
    description:
      'Plans are rectangles. A circular, elliptical, L-shaped or courtyard footprint is approximated by a rectangle, which changes both the wind area and the plan stiffness.',
  },
  {
    id: 'internal-void',
    name: 'No internal voids',
    description:
      'A storey is a solid gross volume times a structural fraction. An atrium, a seating bowl or a double-height hall is not subtracted, so both floor area and material volume are overstated.',
  },
  {
    id: 'openings',
    name: 'No large openings',
    description:
      'Every storey is treated as a closed box. Hangar doors, open ends and open sides are not modelled, and neither is the internal pressure they would cause.',
  },
  {
    id: 'occupancy-load',
    name: 'No occupancy load',
    description:
      'Only structural self-weight is counted. Crowds, snow, equipment and fit-out are absent — which matters most for a building whose whole purpose is holding a crowd.',
  },
]

/** Look up a caveat's sentence. Unknown ids are dropped, never rendered raw. */
export function caveatText(id: string): string | undefined {
  return BLUEPRINT_CAVEATS.find((entry) => entry.id === id)?.description
}
