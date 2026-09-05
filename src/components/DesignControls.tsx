/**
 * The dials a student turns. Every control writes to the design store; none
 * of them touches an engine result, because the engine result is derived.
 *
 * Material and lateral system apply to the selected storey, or to the whole
 * stack when nothing is selected. That is the cheapest way to support both
 * "make the whole thing steel" and "brace the ground floor" without a mode
 * switch to explain.
 */

import {
  BUILDABLE_SYSTEMS,
  EXPOSURE_CATEGORIES,
  LATERAL_SYSTEMS,
  MATERIAL_LIBRARY,
  type ExposureCategory,
  type LateralSystem,
} from '@/engine'
import {
  ANCHOR_CAPACITY_LIMITS_KN,
  GUST_SPEED_LIMITS_KMH,
  PLAN_WIDTH_LIMITS_M,
  STOREY_COUNT_LIMITS,
} from '@/lib/limits.ts'
import { useDesignStore } from '@/store/design.ts'

const MATERIALS = [...MATERIAL_LIBRARY.values()]
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
        <span className="text-neutral-400">{label}</span>
        <span className="tabular-nums text-neutral-200">{value}</span>
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
  return (
    <input
      type="range"
      {...rest}
      onChange={(event) => onChange(Number(event.target.value))}
      className="w-full accent-wind"
    />
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t border-neutral-900 pt-4">
      <h3 className="text-[0.65rem] uppercase tracking-wider text-neutral-600">
        {title}
      </h3>
      {children}
    </section>
  )
}

const SELECT_CLASS =
  'w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200'

export function DesignControls() {
  const structure = useDesignStore((state) => state.structure)
  const hazard = useDesignStore((state) => state.hazard)
  const selectedStoreyIndex = useDesignStore((state) => state.selectedStoreyIndex)

  const setGustSpeed = useDesignStore((state) => state.setGustSpeed)
  const setDirection = useDesignStore((state) => state.setDirection)
  const setExposure = useDesignStore((state) => state.setExposure)
  const addStorey = useDesignStore((state) => state.addStorey)
  const removeStorey = useDesignStore((state) => state.removeStorey)
  const setPlanDimensions = useDesignStore((state) => state.setPlanDimensions)
  const setAnchorCapacity = useDesignStore((state) => state.setAnchorCapacity)
  const setStoreyMaterial = useDesignStore((state) => state.setStoreyMaterial)
  const setStoreySystem = useDesignStore((state) => state.setStoreySystem)
  const setAllMaterial = useDesignStore((state) => state.setAllMaterial)
  const setAllSystem = useDesignStore((state) => state.setAllSystem)
  const reset = useDesignStore((state) => state.reset)

  const storeys = structure.storeys
  const ground = storeys[0]
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
  const uniform = <K extends 'materialId' | 'lateralSystem'>(key: K): string => {
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
  const targetLabel = selected ? `Storey ${selected.index + 1}` : 'All storeys'

  // Only meaningful when one material governs the target; with a mixed stack
  // there is no single class to check buildability against.
  const structuralClass = materialId
    ? MATERIAL_LIBRARY.get(materialId)?.structuralClass
    : undefined

  return (
    <div className="space-y-4">
      <Group title="Hazard">
        <Field label="Gust speed" value={`${hazard.gustSpeed_kmh} km/h`}>
          <Slider
            min={GUST_SPEED_LIMITS_KMH.min}
            max={GUST_SPEED_LIMITS_KMH.max}
            step={5}
            value={hazard.gustSpeed_kmh}
            onChange={setGustSpeed}
          />
        </Field>

        <Field label="Wind direction" value={`${Math.round(hazard.directionDeg)}°`}>
          <Slider
            min={0}
            max={355}
            step={5}
            value={hazard.directionDeg}
            onChange={setDirection}
          />
        </Field>
        <p className="-mt-1 text-[0.65rem] text-neutral-600">
          Bearing the wind blows towards in plan. 0° = along +X, 90° = along +Y.
        </p>

        <div>
          <span className="text-xs text-neutral-400">Exposure category</span>
          <div className="mt-1.5 grid grid-cols-3 gap-1">
            {EXPOSURE_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setExposure(category)}
                title={EXPOSURE_HINT[category]}
                className={`rounded border px-2 py-1.5 text-xs ${
                  structure.exposureCategory === category
                    ? 'border-wind bg-wind/15 text-neutral-100'
                    : 'border-neutral-800 text-neutral-400 hover:border-neutral-600'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[0.65rem] text-neutral-600">
            {EXPOSURE_HINT[structure.exposureCategory]}
          </p>
        </div>
      </Group>

      <Group title="Massing">
        <Field label="Storeys" value={String(storeys.length)}>
          <span className="flex gap-1">
            <button
              type="button"
              onClick={removeStorey}
              disabled={storeys.length <= STOREY_COUNT_LIMITS.min}
              className="flex-1 rounded border border-neutral-800 py-1 text-xs text-neutral-300 hover:border-neutral-600 disabled:opacity-30"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={addStorey}
              disabled={storeys.length >= STOREY_COUNT_LIMITS.max}
              className="flex-1 rounded border border-neutral-800 py-1 text-xs text-neutral-300 hover:border-neutral-600 disabled:opacity-30"
            >
              Add
            </button>
          </span>
        </Field>

        <Field label="Plan X" value={`${ground?.widthX_m ?? 0} m`}>
          <Slider
            min={PLAN_WIDTH_LIMITS_M.min}
            max={PLAN_WIDTH_LIMITS_M.max}
            step={1}
            value={ground?.widthX_m ?? PLAN_WIDTH_LIMITS_M.min}
            onChange={(widthX_m) =>
              setPlanDimensions(widthX_m, ground?.widthY_m ?? PLAN_WIDTH_LIMITS_M.min)
            }
          />
        </Field>

        <Field label="Plan Y" value={`${ground?.widthY_m ?? 0} m`}>
          <Slider
            min={PLAN_WIDTH_LIMITS_M.min}
            max={PLAN_WIDTH_LIMITS_M.max}
            step={1}
            value={ground?.widthY_m ?? PLAN_WIDTH_LIMITS_M.min}
            onChange={(widthY_m) =>
              setPlanDimensions(ground?.widthX_m ?? PLAN_WIDTH_LIMITS_M.min, widthY_m)
            }
          />
        </Field>

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

      <Group title={`Material — ${targetLabel}`}>
        {!selected && (
          <p className="-mt-1 text-[0.65rem] text-neutral-600">
            Click a storey in the model to edit it on its own.
          </p>
        )}

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

      <button
        type="button"
        onClick={reset}
        className="w-full rounded border border-neutral-800 py-1.5 text-xs text-neutral-500 hover:border-neutral-600 hover:text-neutral-300"
      >
        Reset design
      </button>
    </div>
  )
}
