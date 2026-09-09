/**
 * The dials a student turns. Every control writes to the design store; none
 * of them touches an engine result, because the engine result is derived.
 *
 * Split in two, by how much you have to know to use it rather than by which
 * part of the model it touches. **Basics** is the loop the product is about —
 * stack floors, size the plan, turn the storm up, watch what goes red — and a
 * twelve year old can drive all of it without being told what any of the words
 * mean. **Advanced** is everything that needs a sentence of structural
 * background first: terrain exposure, hold-down capacity, the material
 * library, the lateral system.
 *
 * The split is presentational and nothing else. Both halves write to the same
 * store, the engine sees one structure either way, and nothing is hidden that
 * a design already on screen depends on — a beginner who opens a shared design
 * built out of bamboo shear walls still sees its numbers, they just do not
 * have the control to change it in front of them.
 *
 * Material and lateral system apply to the selected storey, or to the whole
 * stack when nothing is selected. That is the cheapest way to support both
 * "make the whole thing steel" and "brace the ground floor" without a mode
 * switch to explain.
 */

import {
  BUILDABLE_SYSTEMS,
  EXPOSURE_CATEGORIES,
  FACADE,
  FACADE_SYSTEMS,
  LATERAL_SYSTEMS,
  MATERIAL_LIBRARY,
  PLAN_SHAPES,
  type ExposureCategory,
  type FacadeSystem,
  type LateralSystem,
  type PlanShape,
} from '@/engine'
import { FACADE_BLURB, FACADE_LABEL } from '@/lib/facade.ts'
import { ARCHETYPES } from '@/lib/typology.ts'
import {
  ANCHOR_CAPACITY_LIMITS_KN,
  GUST_SPEED_LIMITS_KMH,
  PLAN_WIDTH_LIMITS_M,
  STOREY_COUNT_LIMITS,
  STOREY_HEIGHT_LIMITS_M,
  TAPER_LIMITS,
} from '@/lib/limits.ts'
import { useDesignStore } from '@/store/design.ts'

const MATERIALS = [...MATERIAL_LIBRARY.values()]

/**
 * Copy for the footprint chips. The blurbs name the consequence rather than the
 * geometry, because the consequence is the lesson: a round plan is the reason
 * chimneys and cooling towers are round.
 */
const PLAN_SHAPE_LABEL: Readonly<Record<PlanShape, string>> = {
  rectangle: 'Rectangle',
  ellipse: 'Round',
}
const PLAN_SHAPE_BLURB: Readonly<Record<PlanShape, string>> = {
  rectangle: 'Flat faces. The wind gets something square to push on.',
  ellipse:
    'The wind slides around it, so a round floor catches roughly half as much — and holds about a fifth less floor, material and weight.',
}
const EXPOSURE_HINT: Readonly<Record<ExposureCategory, string>> = {
  B: 'Urban / wooded',
  C: 'Open terrain',
  D: 'Flat, water',
}

function Field({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-xs">
        <span className="text-ink/65">{label}</span>
        <span className="font-display tabular-nums text-ink">{value}</span>
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  )
}

function Slider(props: {
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
}) {
  const { onChange, ...rest } = props
  // How this looks lives in index.css, not here: the browser draws a range
  // input itself and the parts that need styling are pseudo-elements Tailwind
  // has no selector for.
  return (
    <input
      type="range"
      {...rest}
      onChange={(event) => onChange(Number(event.target.value))}
      className="w-full"
    />
  )
}

function Group({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="slab space-y-3 p-3">
      <div>
        <h3 className="font-pixel text-[0.7rem] uppercase tracking-widest text-ink/45">
          {title}
        </h3>
        {hint !== undefined && (
          <p className="mt-1 text-[0.65rem] leading-relaxed text-ink/50">{hint}</p>
        )}
      </div>
      {children}
    </section>
  )
}

const SELECT_CLASS =
  'w-full rounded-lg border-2 border-ink/15 bg-paper px-2 py-1.5 text-xs text-ink focus:border-ink focus:outline-none'

const CHIP_BUTTON_CLASS =
  'flex-1 rounded-lg border-2 border-ink/15 bg-paper py-1 font-display text-xs text-ink hover:border-ink disabled:opacity-30 disabled:hover:border-ink/15'

/** A picked-or-not chip, the shape the exposure buttons already use. */
function chipClass(active: boolean): string {
  return `rounded-lg border-2 px-2 py-1.5 font-display text-xs ${
    active
      ? 'border-ink bg-bloom/35 text-ink shadow-[2px_2px_0_0_var(--color-ink)]'
      : 'border-ink/15 bg-paper text-ink/55 hover:border-ink/40'
  }`
}

/** Percentage of the wall that is glass, for a label. */
function glassPercent(facade: FacadeSystem): string {
  return `${Math.round(FACADE[facade].windowToWallRatio * 100)}% glass`
}

/**
 * Stack it, size it, blow on it. Everything a student needs to reach the
 * lesson — that making a building safer costs carbon and money — without
 * knowing what a lateral system is.
 */
export function BasicControls() {
  const structure = useDesignStore((state) => state.structure)
  const hazard = useDesignStore((state) => state.hazard)

  const setGustSpeed = useDesignStore((state) => state.setGustSpeed)
  const setDirection = useDesignStore((state) => state.setDirection)
  const addStorey = useDesignStore((state) => state.addStorey)
  const removeStorey = useDesignStore((state) => state.removeStorey)
  const setPlanDimensions = useDesignStore((state) => state.setPlanDimensions)
  const setStoreyHeight = useDesignStore((state) => state.setStoreyHeight)
  const setPlanShape = useDesignStore((state) => state.setPlanShape)
  const selectedStoreyIndex = useDesignStore((state) => state.selectedStoreyIndex)
  const selectStorey = useDesignStore((state) => state.selectStorey)
  const setTaper = useDesignStore((state) => state.setTaper)
  const setAllFacade = useDesignStore((state) => state.setAllFacade)
  const setTypology = useDesignStore((state) => state.setTypology)
  const taper = useDesignStore((state) => state.taper)
  const reset = useDesignStore((state) => state.reset)

  const storeys = structure.storeys
  // The size sliders act on the selected storey, or on the whole stack when
  // nothing is selected — the idiom the material and envelope controls already
  // use. `edited` is the storey whose numbers the sliders show; a selection
  // pointing nowhere (it cannot, but the compiler does not know that) falls back
  // to the ground storey rather than rendering an empty control.
  const selected =
    selectedStoreyIndex !== null && storeys[selectedStoreyIndex] !== undefined
      ? selectedStoreyIndex
      : null
  const ground = storeys[0]
  const edited = (selected === null ? ground : storeys[selected]) ?? ground
  // With no selection the chips describe the whole stack, so they only show a
  // shape when the stack agrees on one. Mirrors the facade and material
  // controls, where '' / undefined renders as "Mixed".
  const shapeOfTarget =
    selected !== null
      ? edited?.planShape
      : storeys.every((storey) => storey.planShape === storeys[0]?.planShape)
        ? storeys[0]?.planShape
        : undefined
  // With no selection the whole stack is being set, so the control only shows
  // a facade when the stack agrees on one. Mirrors the material control.
  const uniformFacade = storeys.every((s) => s.facade === storeys[0]?.facade)
    ? storeys[0]?.facade
    : undefined

  return (
    <div className="space-y-4">
      <div data-tour="typology">
      <Group
        title="Building type"
        hint="A starting point. Every control below still works on it afterwards."
      >
        <div className="grid grid-cols-3 gap-1.5">
          {ARCHETYPES.map((entry) => (
            <button
              key={entry.typology}
              type="button"
              title={entry.blurb}
              onClick={() => setTypology(entry.typology)}
              className={chipClass(structure.typology === entry.typology)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {structure.typology === 'custom' ? (
          <p className="text-[11px] leading-snug text-ink/55">
            Your own design. Picking a type replaces it with that starting point.
          </p>
        ) : null}
      </Group>
      </div>

      <div data-tour="size">
      <Group
        title={selected === null ? 'Your building' : `Storey ${selected + 1}`}
        hint={
          selected === null
            ? 'How many floors, and how big each one is. Click a storey in the model to shape just that one.'
            : 'Height and plan for this storey alone. The floors above simply sit on it.'
        }
      >
        {selected !== null && (
          <button
            type="button"
            onClick={() => selectStorey(null)}
            className="w-full rounded-lg border-2 border-ink/15 bg-paper py-1 font-display text-[0.7rem] text-ink/60 hover:border-ink hover:text-ink"
          >
            Back to the whole building
          </button>
        )}

        <Field label="Storeys" value={String(storeys.length)}>
          <span className="flex gap-1">
            <button
              type="button"
              onClick={removeStorey}
              disabled={storeys.length <= STOREY_COUNT_LIMITS.min}
              className={CHIP_BUTTON_CLASS}
            >
              Remove
            </button>
            <button
              type="button"
              onClick={addStorey}
              disabled={storeys.length >= STOREY_COUNT_LIMITS.max}
              className={CHIP_BUTTON_CLASS}
            >
              Add
            </button>
          </span>
        </Field>

        {/* Height, not just floor count: the two are different questions, and a
            single-volume building (a hall, a warehouse, an arena) is the case
            where floor count alone cannot express it. */}
        <Field label="Floor height" value={`${edited?.height_m ?? 0} m`}>
          <Slider
            min={STOREY_HEIGHT_LIMITS_M.min}
            max={STOREY_HEIGHT_LIMITS_M.max}
            step={0.1}
            value={edited?.height_m ?? STOREY_HEIGHT_LIMITS_M.min}
            onChange={(height_m) =>
              selected === null
                ? setStoreyHeight(height_m)
                : setStoreyHeight(height_m, selected)
            }
          />
        </Field>

        <Field label="Width (X)" value={`${edited?.widthX_m ?? 0} m`}>
          <Slider
            min={PLAN_WIDTH_LIMITS_M.min}
            max={PLAN_WIDTH_LIMITS_M.max}
            step={1}
            value={edited?.widthX_m ?? PLAN_WIDTH_LIMITS_M.min}
            onChange={(widthX_m) =>
              setPlanDimensions(
                widthX_m,
                edited?.widthY_m ?? PLAN_WIDTH_LIMITS_M.min,
                selected ?? undefined,
              )
            }
          />
        </Field>

        <Field label="Depth (Y)" value={`${edited?.widthY_m ?? 0} m`}>
          <Slider
            min={PLAN_WIDTH_LIMITS_M.min}
            max={PLAN_WIDTH_LIMITS_M.max}
            step={1}
            value={edited?.widthY_m ?? PLAN_WIDTH_LIMITS_M.min}
            onChange={(widthY_m) =>
              setPlanDimensions(
                edited?.widthX_m ?? PLAN_WIDTH_LIMITS_M.min,
                widthY_m,
                selected ?? undefined,
              )
            }
          />
        </Field>

        {/* The footprint is a real engine input, not a drawing option: it moves
            floor area, envelope area, the face the wind meets, the section the
            storey bends over and the force coefficient. See engine/plan.ts. */}
        <div className="grid grid-cols-2 gap-1">
          {PLAN_SHAPES.map((shape) => (
            <button
              key={shape}
              type="button"
              onClick={() => setPlanShape(shape, selected ?? undefined)}
              className={chipClass(shapeOfTarget === shape)}
            >
              {PLAN_SHAPE_LABEL[shape]}
            </button>
          ))}
        </div>
        <p className="-mt-1 text-[0.65rem] leading-relaxed text-ink/50">
          {shapeOfTarget === undefined
            ? 'Different floors have different footprints. Pick one to make them match.'
            : PLAN_SHAPE_BLURB[shapeOfTarget]}
        </p>

        {/* Whole-stack by nature: a taper is a rule about how the plan changes
            with height, so it regenerates every width and replaces any shaping
            done storey by storey. The note says so rather than the control
            silently undoing the student's work. */}
        <Field label="Taper" value={`${Math.round(taper * 100)}%`}>
          <Slider
            min={TAPER_LIMITS.min}
            max={TAPER_LIMITS.max}
            step={0.05}
            value={taper}
            onChange={setTaper}
          />
        </Field>
        <p className="-mt-1 text-[0.65rem] leading-relaxed text-ink/45">
          Narrow the top floors. Less area up high, where the wind is
          strongest — and less building to pay for. It shapes the whole stack,
          so it replaces any floor you sized on its own.
        </p>
      </Group>
      </div>

      <Group
        title="Windows"
        hint="The skin, not the skeleton. It is most of what you see, a large part of what you pay, and it changes how heavy the tower is."
      >
        <div className="grid grid-cols-2 gap-1">
          {FACADE_SYSTEMS.map((facade) => (
            <button
              key={facade}
              type="button"
              onClick={() => setAllFacade(facade)}
              className={chipClass(uniformFacade === facade)}
            >
              {FACADE_LABEL[facade]}
              <span className="mt-0.5 block text-[0.6rem] font-normal opacity-70">
                {glassPercent(facade)}
              </span>
            </button>
          ))}
        </div>
        <p className="text-[0.65rem] leading-relaxed text-ink/50">
          {uniformFacade === undefined
            ? 'Different floors have different skins. Pick one to make the whole tower match.'
            : FACADE_BLURB[uniformFacade]}
        </p>
      </Group>

      <div data-tour="wind">
      <Group
        title="The storm"
        hint="A gust, and the direction it blows towards. Wide faces catch more of it."
      >
        <Field label="Gust speed" value={`${hazard.gustSpeed_kmh} km/h`}>
          <Slider
            min={GUST_SPEED_LIMITS_KMH.min}
            max={GUST_SPEED_LIMITS_KMH.max}
            step={5}
            value={hazard.gustSpeed_kmh}
            onChange={setGustSpeed}
          />
        </Field>

        <Field label="Direction" value={`${Math.round(hazard.directionDeg)}°`}>
          <Slider
            min={0}
            max={355}
            step={5}
            value={hazard.directionDeg}
            onChange={setDirection}
          />
        </Field>
        <p className="-mt-1 text-[0.65rem] leading-relaxed text-ink/45">
          0° blows along the width, 90° along the depth.
        </p>
      </Group>
      </div>

      <button
        type="button"
        onClick={reset}
        className="w-full rounded-full border-2 border-ink/15 bg-white py-1.5 font-display text-xs text-ink/60 hover:border-ink hover:text-ink"
      >
        Start over
      </button>
    </div>
  )
}

/**
 * The controls that need a sentence of structural background before they mean
 * anything. Grouped so each one carries that sentence with it.
 */
export function AdvancedControls() {
  const structure = useDesignStore((state) => state.structure)
  const selectedStoreyIndex = useDesignStore((state) => state.selectedStoreyIndex)

  const setExposure = useDesignStore((state) => state.setExposure)
  const setAnchorCapacity = useDesignStore((state) => state.setAnchorCapacity)
  const setStoreyMaterial = useDesignStore((state) => state.setStoreyMaterial)
  const setStoreySystem = useDesignStore((state) => state.setStoreySystem)
  const setStoreyFacade = useDesignStore((state) => state.setStoreyFacade)
  const setAllMaterial = useDesignStore((state) => state.setAllMaterial)
  const setAllSystem = useDesignStore((state) => state.setAllSystem)
  const setAllFacade = useDesignStore((state) => state.setAllFacade)

  const storeys = structure.storeys
  const selectedStorey =
    selectedStoreyIndex === null ? undefined : storeys[selectedStoreyIndex]
  // Bundled so the index and the storey are narrowed together; the callbacks
  // below then need no non-null assertions.
  const selected =
    selectedStoreyIndex !== null && selectedStorey !== undefined
      ? { index: selectedStoreyIndex, storey: selectedStorey }
      : null

  // With no selection the controls act on every storey, so they show a shared
  // value only when the stack actually agrees. '' renders as "Mixed".
  const uniform = <K extends 'materialId' | 'lateralSystem' | 'facade'>(
    key: K,
  ): string => {
    const first = storeys[0]
    if (!first) return ''
    return storeys.every((storey) => storey[key] === first[key])
      ? String(first[key])
      : ''
  }

  const materialId = selected ? selected.storey.materialId : uniform('materialId')
  const lateralSystem = selected
    ? selected.storey.lateralSystem
    : uniform('lateralSystem')
  const facade = selected ? selected.storey.facade : uniform('facade')
  const targetLabel = selected ? `Storey ${selected.index + 1}` : 'All storeys'

  // Only meaningful when one material governs the target; with a mixed stack
  // there is no single class to check buildability against.
  const structuralClass = materialId
    ? MATERIAL_LIBRARY.get(materialId)?.structuralClass
    : undefined

  return (
    <div className="space-y-4">
      <Group
        title={`Material — ${targetLabel}`}
        hint={
          selected
            ? 'Applies to the selected storey only.'
            : 'Click a storey in the model to change just that one.'
        }
      >
        <select
          value={materialId}
          onChange={(event) =>
            selected
              ? setStoreyMaterial(selected.index, event.target.value)
              : setAllMaterial(event.target.value)
          }
          className={SELECT_CLASS}
        >
          {materialId === '' && <option value="">Mixed</option>}
          {MATERIALS.map((material) => (
            <option key={material.id} value={material.id}>
              {material.name}
            </option>
          ))}
        </select>

        <select
          value={lateralSystem}
          onChange={(event) => {
            const system = event.target.value as LateralSystem
            if (selected) setStoreySystem(selected.index, system)
            else setAllSystem(system)
          }}
          className={SELECT_CLASS}
        >
          {lateralSystem === '' && <option value="">Mixed</option>}
          {LATERAL_SYSTEMS.map((system) => {
            // Implausible pairings stay selectable — the engine warns rather
            // than refuses, and reading why rammed earth cannot be a moment
            // frame is the lesson.
            const buildable =
              structuralClass === undefined ||
              BUILDABLE_SYSTEMS[structuralClass].has(system)
            return (
              <option key={system} value={system}>
                {system}
                {buildable ? '' : ' (implausible)'}
              </option>
            )
          })}
        </select>
      </Group>

      <Group
        title={`Envelope — ${targetLabel}`}
        hint="Per storey, so a glazed lobby can sit under a solid tower. Basics sets the whole stack at once."
      >
        <select
          value={facade}
          onChange={(event) => {
            const next = event.target.value as FacadeSystem
            if (selected) setStoreyFacade(selected.index, next)
            else setAllFacade(next)
          }}
          className={SELECT_CLASS}
        >
          {facade === '' && <option value="">Mixed</option>}
          {FACADE_SYSTEMS.map((system) => (
            <option key={system} value={system}>
              {FACADE_LABEL[system]} — {glassPercent(system)}
            </option>
          ))}
        </select>
      </Group>

      <Group
        title="Exposure"
        hint="What the wind crossed before it reached you. Rougher ground slows it down near the base."
      >
        <div className="grid grid-cols-3 gap-1">
          {EXPOSURE_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setExposure(category)}
              title={EXPOSURE_HINT[category]}
              className={`rounded-lg border-2 px-2 py-1.5 font-display text-xs ${
                structure.exposureCategory === category
                  ? 'border-ink bg-bloom/35 text-ink shadow-[2px_2px_0_0_var(--color-ink)]'
                  : 'border-ink/15 bg-paper text-ink/55 hover:border-ink/40'
              }`}
            >
              {category}
            </button>
          ))}
        </div>
        <p className="text-[0.65rem] text-ink/45">
          {EXPOSURE_HINT[structure.exposureCategory]}
        </p>
      </Group>

      <Group
        title="Foundation"
        hint="How hard the hold-downs pull back before the tower can tip off its base."
      >
        <Field
          label="Anchor capacity"
          value={`${structure.foundation.anchorCapacity_kN} kN`}
        >
          <Slider
            min={ANCHOR_CAPACITY_LIMITS_KN.min}
            max={ANCHOR_CAPACITY_LIMITS_KN.max}
            step={50}
            value={structure.foundation.anchorCapacity_kN}
            onChange={setAnchorCapacity}
          />
        </Field>
      </Group>
    </div>
  )
}
