/**
 * Prompt construction. Pure, and deliberately import-free apart from types,
 * because this module is bundled into the Vite config so the dev-server
 * middleware can build prompts without shipping the API key to the browser.
 *
 * THE ONE RULE, in prompt form. The system message forbids the model from
 * producing a number, and the user message hands it every number it could
 * legitimately need. That instruction is not trusted on its own: `guard.ts`
 * checks the response against the same context afterwards. Prompt discipline
 * is the request; the guard is the verification.
 */

import type { CritiqueContext, CritiqueHazard } from './types.ts'

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export const SYSTEM_PROMPT = `You are a structural engineering tutor helping a first-year student understand why their building design passes or fails under a natural hazard: a wind storm, an earthquake, or a flood. The FACTS say which one, and the three behave very differently — wind pushes hardest at the top, an earthquake's force grows with the building's own weight, and a flood loads the bottom and tries to float it. Explain the one you were given.

A deterministic physics engine has already analysed the design. Its results are given to you as FACTS. Your job is to explain and advise. It is not to calculate.

HARD RULES:
1. Never compute, estimate, derive or invent a number. Not a force, not a safety factor, not a percentage, not a cost, not a mass.
2. You may quote a figure only if it appears verbatim in the FACTS. Quote it exactly as written there, including its units.
3. If your point needs a quantity that is not in the FACTS, make the point in words instead. "The upper storeys carry noticeably less load" is correct; inventing the figure is not.
4. Do not predict what a change would produce numerically. Say a change would reduce drift; never say by how much. The student will apply it and the engine will tell them.
5. Only recommend materials and lateral systems listed in the FACTS.
6. Do not advise about a hazard you were not given. If the FACTS describe a flood, do not talk about wind speeds; the student chose one event and is looking at its numbers.

Style: plain English, no jargon without a gloss, warm but direct. A student reads this to learn, not to be flattered.

Reply with a single JSON object and nothing else, in this shape:
{
  "verdict": "one sentence, under 20 words, on whether this design stands up",
  "explanation": "60-120 words on WHY the governing failure mode is what it is, in physical terms the student can picture",
  "suggestions": [
    {
      "change": "one concrete edit the student can make with the controls",
      "rationale": "why it addresses the governing problem",
      "tradeoff": "what it costs in carbon, money or space"
    }
  ]
}

Give two or three suggestions. Every suggestion must name a real tradeoff; a change with no downside is almost always a change you have not thought through.`

function fixed(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return 'not governing (no finite value)'
  return value.toFixed(decimals)
}

function driftText(denominator: number): string {
  return Number.isFinite(denominator) ? `h/${denominator}` : 'negligible'
}

/**
 * The hazard block, which is the one part of the fact sheet that differs
 * between the three events.
 *
 * Only the lines the hazard actually has. A `CritiqueHazard` leaves the fields
 * that do not apply undefined, so this reads them rather than printing
 * "gust speed: 0 km/h" at an earthquake — which would be a figure about a
 * quantity that does not exist, and a figure the guard would then happily
 * accept the model quoting.
 */
function hazardLines(hazard: CritiqueHazard): string[] {
  const lines = [`- This is ${hazard.description}.`]

  if (hazard.gustSpeed_kmh !== undefined) {
    lines.push(`- Wind gust speed: ${fixed(hazard.gustSpeed_kmh, 0)} km/h`)
  }
  if (hazard.exposureCategory !== undefined) {
    lines.push(
      `- Exposure category ${hazard.exposureCategory} (${hazard.exposureDescription ?? ''})`,
    )
  }
  if (hazard.Ss_g !== undefined && hazard.S1_g !== undefined) {
    lines.push(
      `- Mapped ground motion: Ss = ${fixed(hazard.Ss_g, 2)} g at short period, ` +
        `S1 = ${fixed(hazard.S1_g, 2)} g at one second`,
    )
  }
  if (hazard.SDS_g !== undefined && hazard.SD1_g !== undefined) {
    lines.push(
      `- Design accelerations after the site adjustment: SDS = ` +
        `${fixed(hazard.SDS_g, 2)} g, SD1 = ${fixed(hazard.SD1_g, 2)} g`,
    )
  }
  if (hazard.siteClass !== undefined) {
    lines.push(`- Site Class ${hazard.siteClass} (${hazard.siteDescription ?? ''})`)
  }
  if (hazard.responseModificationR !== undefined) {
    lines.push(
      `- Response modification factor R = ${hazard.responseModificationR}, from ` +
        'the weakest lateral system in the building',
    )
  }
  if (hazard.approximatePeriod_s !== undefined) {
    lines.push(
      `- Approximate fundamental period: ${fixed(hazard.approximatePeriod_s, 2)} s`,
    )
  }
  if (hazard.depth_m !== undefined) {
    lines.push(`- Stillwater depth above grade: ${fixed(hazard.depth_m, 1)} m`)
  }
  if (hazard.velocity_ms !== undefined) {
    lines.push(`- Flow velocity: ${fixed(hazard.velocity_ms, 1)} m/s`)
  }

  lines.push(`- Direction in plan: ${fixed(hazard.directionDeg, 0)} degrees`)
  return lines
}

/**
 * Renders the context as a labelled plain-text block rather than raw JSON.
 * Small models quote prose facts back more reliably than they quote nested
 * JSON, and the units sit next to the numbers where they cannot be lost.
 */
export function renderFacts(context: CritiqueContext): string {
  const { hazard, building, score, stability, limits } = context

  const lines: string[] = [
    'HAZARD',
    ...hazardLines(hazard),
    '',
    'BUILDING',
    `- ${building.storeyCount} storeys, ${fixed(building.totalHeight_m, 1)} m tall`,
    `- Plan ${fixed(building.planX_m, 1)} m by ${fixed(building.planY_m, 1)} m`,
    `- Gross floor area: ${fixed(building.floorArea_m2, 0)} m2`,
    `- Slenderness (height / narrow plan dimension): ${fixed(building.slendernessRatio, 2)}`,
    `- Foundation: ${building.foundationType}, embedded ${fixed(building.embedmentDepth_m, 2)} m, anchors ${fixed(building.anchorCapacity_kN, 0)} kN`,
    '',
    'RESULTS',
    `- Governing failure mode: ${score.governingFailureMode}`,
    `- Safety factor: ${fixed(score.safetyFactor, 2)} (target ${fixed(limits.targetSafetyFactor, 2)})`,
    `- Factor of safety against overturning: ${fixed(stability.factorOfSafetyOverturning, 2)}`,
    `- Factor of safety against sliding: ${fixed(stability.factorOfSafetySliding, 2)}`,
    ...(stability.factorOfSafetyFlotation === undefined
      ? []
      : [
          `- Factor of safety against flotation: ${fixed(stability.factorOfSafetyFlotation, 2)}`,
          `- Buoyant uplift from the water it displaces: ${fixed(stability.buoyancy_kN ?? 0, 0)} kN`,
        ]),
    `- Worst storey drift: ${driftText(score.worstDriftDenominator)} (limit ${driftText(limits.driftLimitDenominator)})`,
    `- Base shear: ${fixed(stability.baseShear_kN, 1)} kN`,
    `- Overturning moment: ${fixed(stability.overturningMoment_kNm, 0)} kNm`,
    `- Restoring moment: ${fixed(stability.restoringMoment_kNm, 0)} kNm`,
    `- Total self weight: ${fixed(stability.totalSelfWeight_kN, 0)} kN`,
    '',
    'SUSTAINABILITY AND COST',
    `- Embodied carbon: ${fixed(score.carbon_kgCO2e, 0)} kg CO2e (${fixed(score.carbonIntensity_kgCO2e_m2, 1)} kgCO2e/m2)`,
    `- Cost: ${fixed(score.cost_usd, 0)} USD (${fixed(score.costIntensity_usd_m2, 0)} USD/m2)`,
    '- Scope: A1-A3, structural frame only. Costs are indicative, not surveyed.',
    '',
    'PER STOREY (1 is the ground storey)',
  ]

  for (const storey of context.storeys) {
    lines.push(
      `- Storey ${storey.label}: ${storey.materialName}, ${storey.lateralSystem}` +
        `, ${storey.facadeName}` +
        `, wind force ${fixed(storey.lateralForce_kN, 1)} kN` +
        `, shear ${fixed(storey.storeyShear_kN, 1)} kN` +
        `, drift ${driftText(storey.driftDenominator)}` +
        `, utilisation ${fixed(storey.utilization * 100, 1)}%` +
        ` (drift ${fixed(storey.driftUtilization * 100, 1)}%, strength ${fixed(storey.strengthUtilization * 100, 1)}%)`,
    )
  }

  lines.push('', 'MATERIALS AVAILABLE (the only ones you may recommend)')
  for (const material of context.materials) {
    lines.push(
      `- ${material.name} (${material.structuralClass}): ` +
        `${fixed(material.embodiedCarbon_kgCO2e_m3, 0)} kgCO2e/m3, ` +
        `${fixed(material.cost_usd_m3, 0)} USD/m3, ` +
        `strength ${fixed(material.yieldStrength_MPa, 0)} MPa, ` +
        `density ${fixed(material.density_kg_m3, 0)} kg/m3`,
    )
  }

  lines.push(
    '',
    'ENVELOPES AVAILABLE (the only ones you may recommend): ' +
      context.facadeNames.join(', ') +
      '. Their carbon, cost and weight are already inside the figures above; ' +
      'you have not been given per-square-metre rates and must not quote any.',
  )

  if (context.warnings.length > 0) {
    lines.push('', 'MODELLING CAVEATS THE ENGINE REPORTED')
    for (const warning of context.warnings) lines.push(`- ${warning}`)
  }

  return lines.join('\n')
}

export function buildMessages(context: CritiqueContext): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `FACTS (produced by the physics engine — every number you are allowed to use is here)\n\n${renderFacts(
        context,
      )}\n\nCritique this design. Reply with the JSON object only.`,
    },
  ]
}
