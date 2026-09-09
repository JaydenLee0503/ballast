/**
 * What the model is allowed to choose from.
 *
 * The mirror image of `ai/context.ts`. There, the engine's *output* is narrowed
 * to the facts a model may quote; here the app's *input space* is narrowed to
 * the ids and ranges a model may pick. Both exist so the prompt module can stay
 * free of engine imports, and both are the only thing the model ever sees.
 *
 * Everything in here is read from the real library and the real limits, so a new
 * material in `data/materials.json` becomes proposable without this file
 * changing, and a tightened slider bound cannot be out of step with what the
 * model is told it may ask for.
 */

import {
  BUILDABLE_SYSTEMS,
  EXPOSURE_CATEGORIES,
  FACADE,
  FACADE_SYSTEMS,
  FOUNDATION_TYPES,
  LATERAL_SYSTEMS,
  MATERIAL_LIBRARY,
  PLAN_SHAPES,
  type ExposureCategory,
  type MaterialLibrary,
  type PlanShape,
} from '@/engine'
import { FACADE_BLURB, FACADE_LABEL } from '@/lib/facade.ts'
import { ARCHETYPES } from '@/lib/typology.ts'
import {
  ANCHOR_CAPACITY_LIMITS_KN,
  EMBEDMENT_DEPTH_LIMITS_M,
  PLAN_WIDTH_LIMITS_M,
  STOREY_COUNT_LIMITS,
  STOREY_HEIGHT_LIMITS_M,
  TAPER_LIMITS,
} from '@/lib/limits.ts'
import {
  BLUEPRINT_CAVEATS,
  type BlueprintCatalogue,
  type BlueprintNamedOption,
} from './types.ts'

/** Copy, not data: the same sentences `ai/context.ts` gives the critique. */
const EXPOSURE_DESCRIPTION: Readonly<Record<ExposureCategory, string>> = {
  B: 'urban or suburban, numerous closely spaced obstructions',
  C: 'open terrain with scattered obstructions — the usual choice',
  D: 'flat unobstructed terrain or water, the most severe',
}

/**
 * The declared building kinds, with the blurbs the chips already carry, plus
 * `'custom'`. `'custom'` is described as the honest absence rather than as an
 * option of last resort, because that is what it is — an arena is a custom
 * design, not a badly-labelled warehouse, and the roof it draws (flat) is the
 * one the engine can justify.
 */
function typologyOptions(): BlueprintNamedOption[] {
  return [
    {
      id: 'custom',
      name: 'Custom',
      description:
        'anything the list below does not genuinely describe. Claims nothing and draws a flat roof',
    },
    ...ARCHETYPES.map((entry) => ({
      id: entry.typology,
      name: entry.label,
      description: entry.blurb,
    })),
  ]
}

/**
 * The footprints. Described by what they do to the building rather than by
 * their geometry, because that is what the model has to reason about — and
 * because the consequence is real: `plan.ts` and `wind.ts` charge an ellipse a
 * different area, perimeter, section and force coefficient.
 */
const PLAN_SHAPE_DESCRIPTION: Readonly<Record<PlanShape, string>> = {
  rectangle:
    'flat faces meeting at corners. The default, and what almost every building is',
  ellipse:
    'a round or oval floor, the widths being its axes. Sheds wind rather than catching it, and holds about a fifth less floor and material than the rectangle around it. Right for a tower, a silo, a drum, a rotunda',
}

function planShapeOptions(): BlueprintNamedOption[] {
  return PLAN_SHAPES.map((shape) => ({
    id: shape,
    name: shape === 'ellipse' ? 'Round' : 'Rectangle',
    description: PLAN_SHAPE_DESCRIPTION[shape],
  }))
}

function facadeOptions(): BlueprintNamedOption[] {
  return FACADE_SYSTEMS.map((facade) => ({
    id: facade,
    name: FACADE_LABEL[facade],
    description:
      `${Math.round(FACADE[facade].windowToWallRatio * 100)}% glass. ` +
      FACADE_BLURB[facade],
  }))
}

export function buildBlueprintCatalogue(
  library: MaterialLibrary = MATERIAL_LIBRARY,
): BlueprintCatalogue {
  return {
    materials: [...library.values()].map((entry) => ({
      id: entry.id,
      name: entry.name,
      structuralClass: entry.structuralClass,
      // Sent so a proposal is plausible on arrival rather than plausible after
      // the engine has warned about it. The engine still warns either way.
      buildableSystems: [...BUILDABLE_SYSTEMS[entry.structuralClass]],
    })),
    lateralSystems: [...LATERAL_SYSTEMS],
    facades: facadeOptions(),
    planShapes: planShapeOptions(),
    foundations: [...FOUNDATION_TYPES],
    exposures: EXPOSURE_CATEGORIES.map((category) => ({
      id: category,
      name: `Exposure ${category}`,
      description: EXPOSURE_DESCRIPTION[category],
    })),
    typologies: typologyOptions(),
    limits: {
      storeyCount: { ...STOREY_COUNT_LIMITS },
      storeyHeight_m: { ...STOREY_HEIGHT_LIMITS_M },
      planWidth_m: { ...PLAN_WIDTH_LIMITS_M },
      taper: { ...TAPER_LIMITS },
      embedmentDepth_m: { ...EMBEDMENT_DEPTH_LIMITS_M },
      anchorCapacity_kN: { ...ANCHOR_CAPACITY_LIMITS_KN },
    },
    caveats: [...BLUEPRINT_CAVEATS],
  }
}
