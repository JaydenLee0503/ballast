/**
 * The prompt that turns "an arena" into a set of slider positions.
 *
 * Pure, and import-free apart from types, because this module is bundled into
 * `vite.config.ts` so the dev-server middleware can build prompts without the
 * API key ever reaching the browser. Same arrangement as `ai/prompt.ts`.
 *
 * THE ONE RULE, in prompt form, pointed the other way. `ai/prompt.ts` forbids
 * the model from producing a number *about* a design. Here the model is
 * choosing the design, so numbers are its job — but only the ones a student
 * could have typed into a control, and only inside the ranges the controls
 * allow. It is still forbidden from stating an outcome: the engine scores the
 * design the instant it lands on screen, and a predicted safety factor would be
 * a number with no formula behind it.
 *
 * As with the critique, the instruction is not trusted on its own. `parse.ts`
 * re-checks every id against the real library, clamps every number to the real
 * limits, and runs the prose back through `ai/guard.ts`.
 */

import type { BlueprintCatalogue, BlueprintNamedOption } from './types.ts'

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export const BLUEPRINT_SYSTEM_PROMPT = `You are setting up a starting point in Ballast, a teaching simulator where a student takes a building, subjects it to a windstorm, and redesigns it to survive with less carbon and less money.

The student has described a building they want to start from. Your job is to choose the INPUTS that describe it: how many storeys, how big each floor is, what it is made of, how it resists sideways load, what its skin is, and what it sits on. Nothing more.

A deterministic physics engine analyses your design the moment it appears. You are not analysing anything.

HARD RULES:
1. Never state or predict a result. Not a safety factor, not a drift, not a base shear, not a mass of carbon, not a cost, not a percentage. Those come from the engine, after your design exists.
2. Every id you write — material, lateral system, facade, foundation, exposure, typology, caveat — must appear verbatim in the CATALOGUE. Never invent one, never abbreviate one, never translate one into ordinary words.
3. Every number must sit inside the range the CATALOGUE gives for that field.
4. Storeys are rectangular boxes stacked bottom to top, and each one sits fully on the one below. If the building genuinely has parts of different size — a tall hall with offices over it, a podium under a tower, a seating bowl with a tier above — say so with "sections", listed from the ground up. If it does not, leave "sections" out and the storeys are identical apart from the taper, which narrows the plan evenly towards the top.
5. Pick "typology" only if one genuinely describes the request. Anything else is "custom", which claims nothing.
6. The engine is deliberately simple, and the student must not be misled about what they are looking at. If the request needs something it cannot represent — a long-span or domed roof, a curved or courtyard plan, cantilevers or seating tiers, open sides, a big internal void, a crowd to carry, or something that is not a building at all — build the closest honest box AND list every matching caveat id. Do not soften this in your own words; the app prints the caveat text itself.

Style for the two prose fields: plain English for a first-year student, no jargon without a gloss, no salesmanship. Say what you built and what you traded away to build it out of stacked boxes.

Reply with a single JSON object and nothing else, in this shape:
{
  "name": "short name for this starting point, under 60 characters",
  "typology": "one id from TYPOLOGIES",
  "storeyCount": 3,
  "storeyHeight_m": 6,
  "widthX_m": 60,
  "widthY_m": 45,
  "taper": 0,
  "materialId": "one id from MATERIALS",
  "lateralSystem": "one id from LATERAL SYSTEMS that the chosen material can form",
  "facade": "one id from FACADES",
  "foundationType": "one id from FOUNDATIONS",
  "embedmentDepth_m": 1.5,
  "anchorCapacity_kN": 1200,
  "exposureCategory": "one id from EXPOSURES",
  "planShape": "one id from PLAN SHAPES; leave it out for an ordinary rectangle",
  "sections": [
    {
      "count": 1,
      "height_m": 12,
      "widthX_m": 60,
      "widthY_m": 45,
      "materialId": "optional; the material above is used when this is left out",
      "lateralSystem": "optional, same rule",
      "facade": "optional, same rule",
      "planShape": "optional, same rule"
    }
  ],
  "interpretation": "one or two sentences on what you actually built, in the student's language",
  "notes": "one or two sentences on the choices worth knowing about: why this material, why this system, what it is not",
  "caveats": ["ids from CAVEATS that apply to this request"]
}

The fields outside "sections" always describe a typical storey and must always be filled in, because they are what "sections" inherits from and what is used when you leave "sections" out. "count" is how many storeys that section is; the counts must add up to no more than the storeyCount range allows.`

function range(label: string, min: number, max: number, unit: string): string {
  return `- ${label}: ${min} to ${max}${unit === '' ? '' : ` ${unit}`}`
}

function options(entries: readonly BlueprintNamedOption[]): string[] {
  return entries.map((entry) => `- ${entry.id} — ${entry.name}: ${entry.description}`)
}

/**
 * The catalogue as labelled prose rather than raw JSON. Small open-weight
 * models copy ids out of a flat list far more reliably than out of nested
 * JSON, and the units sit next to the ranges where they cannot be lost.
 */
export function renderCatalogue(catalogue: BlueprintCatalogue): string {
  const { limits } = catalogue
  const lines: string[] = [
    'MATERIALS (id — name, and the lateral systems it can form)',
  ]
  for (const material of catalogue.materials) {
    lines.push(
      `- ${material.id} — ${material.name} (${material.structuralClass}); ` +
        `can form: ${material.buildableSystems.join(', ')}`,
    )
  }

  lines.push('', `LATERAL SYSTEMS: ${catalogue.lateralSystems.join(', ')}`)

  lines.push('', 'FACADES')
  lines.push(...options(catalogue.facades))

  lines.push('', 'PLAN SHAPES')
  lines.push(...options(catalogue.planShapes))

  lines.push('', `FOUNDATIONS: ${catalogue.foundations.join(', ')}`)

  lines.push('', 'EXPOSURES')
  lines.push(...options(catalogue.exposures))

  lines.push('', 'TYPOLOGIES')
  lines.push(...options(catalogue.typologies))

  lines.push(
    '',
    'RANGES (a value outside these will be pulled back to the edge)',
    range('storeyCount', limits.storeyCount.min, limits.storeyCount.max, 'floors'),
    range('storeyHeight_m', limits.storeyHeight_m.min, limits.storeyHeight_m.max, 'm'),
    range('widthX_m and widthY_m', limits.planWidth_m.min, limits.planWidth_m.max, 'm'),
    range('taper', limits.taper.min, limits.taper.max, '(0 is a plain box)'),
    range(
      'embedmentDepth_m',
      limits.embedmentDepth_m.min,
      limits.embedmentDepth_m.max,
      'm',
    ),
    range(
      'anchorCapacity_kN',
      limits.anchorCapacity_kN.min,
      limits.anchorCapacity_kN.max,
      'kN',
    ),
  )

  lines.push('', 'CAVEATS (cite the ids that apply; the app prints the text)')
  lines.push(...options(catalogue.caveats))

  return lines.join('\n')
}

export function buildBlueprintMessages(
  description: string,
  catalogue: BlueprintCatalogue,
): ChatMessage[] {
  return [
    { role: 'system', content: BLUEPRINT_SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `CATALOGUE (the only ids and ranges you may use)\n\n${renderCatalogue(catalogue)}\n\n` +
        `THE STUDENT ASKED FOR\n\n${description.trim()}\n\n` +
        'Choose the inputs for that starting point. Reply with the JSON object only.',
    },
  ]
}
