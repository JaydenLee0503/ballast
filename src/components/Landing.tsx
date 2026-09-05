/**
 * The front door.
 *
 * Everything claimed here is claimed by the engine too — the drift ratios in
 * the diagram are real output for the default six-storey design, and the
 * limitations section is the same list `analyze()` raises as warnings. A
 * landing page that oversells a teaching model is the fastest way to make the
 * model untrustworthy the moment somebody opens it.
 *
 * No imported artwork: the diagram is inline SVG using the shared palette, so
 * the page has nothing to fetch and cannot render wrong because an asset was
 * slow. Same rule as the 3D viewport.
 */

import { BAND_HEX, WIND_HEX, type UtilizationBand } from '@/lib/palette.ts'

/**
 * The default design's per-storey drift, ground floor first — real numbers
 * from the engine, not decoration. Drift is worst at the bottom because storey
 * shear accumulates downward: the ground floor carries every storey above it.
 */
const DEMO_STOREYS: ReadonlyArray<{ drift: string; band: UtilizationBand }> = [
  { drift: 'h/769', band: 'fail' },
  { drift: 'h/897', band: 'caution' },
  { drift: 'h/1081', band: 'caution' },
  { drift: 'h/1400', band: 'safe' },
  { drift: 'h/2050', band: 'safe' },
  { drift: 'h/4015', band: 'safe' },
]

const STOREY_H = 42
const BASE_Y = 336
const LEFT = 148
const WIDTH = 118

function BuildingDiagram() {
  return (
    <svg
      viewBox="0 0 340 372"
      className="h-auto w-full max-w-sm"
      role="img"
      aria-label="A six-storey building under wind load. Storeys are coloured by how hard they are working; the ground storey is over its drift limit at h/769 while the top storey has reserve at h/4015."
    >
      <defs>
        <marker
          id="ballast-arrow"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3.5"
          orient="auto"
        >
          <path d="M0,0 L7,3.5 L0,7 z" fill={WIND_HEX} />
        </marker>
      </defs>

      {DEMO_STOREYS.map((storey, i) => {
        const y = BASE_Y - (i + 1) * STOREY_H
        const midY = BASE_Y - (i + 0.5) * STOREY_H
        // Wind pressure grows with height (the Kz profile), so the arrows do.
        const arrow = 28 + i * 9
        return (
          <g key={storey.drift}>
            <line
              x1={LEFT - 12 - arrow}
              y1={midY}
              x2={LEFT - 14}
              y2={midY}
              stroke={WIND_HEX}
              strokeWidth="1.5"
              markerEnd="url(#ballast-arrow)"
            />
            <rect
              x={LEFT}
              y={y + 2}
              width={WIDTH}
              height={STOREY_H - 4}
              rx="1.5"
              fill={BAND_HEX[storey.band]}
              fillOpacity="0.18"
              stroke={BAND_HEX[storey.band]}
              strokeWidth="1.25"
            />
            <text
              x={LEFT + WIDTH + 12}
              y={midY + 4}
              className="fill-neutral-500 text-[11px] tabular-nums"
            >
              {storey.drift}
            </text>
          </g>
        )
      })}

      {/* Foundation and ground. */}
      <rect
        x={LEFT - 10}
        y={BASE_Y}
        width={WIDTH + 20}
        height="12"
        fill="#292524"
        stroke="#44403c"
        strokeWidth="1"
      />
      <line
        x1="24"
        y1={BASE_Y + 12}
        x2="316"
        y2={BASE_Y + 12}
        stroke="#44403c"
        strokeWidth="1"
      />
      <text x="24" y={BASE_Y + 30} className="fill-neutral-600 text-[11px]">
        150 km/h gust · Exposure C
      </text>
    </svg>
  )
}

function Dial({
  label,
  value,
  caption,
  fill,
  colour,
}: {
  label: string
  value: string
  caption: string
  /** 0-1, how far the bar runs. */
  fill: number
  colour: string
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="text-[0.65rem] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-2xl tabular-nums text-neutral-100">{value}</div>
      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full rounded-full"
          style={{ width: `${fill * 100}%`, backgroundColor: colour }}
        />
      </div>
      <p className="mt-3 text-[0.75rem] leading-relaxed text-neutral-500">
        {caption}
      </p>
    </div>
  )
}

function Step({
  n,
  title,
  children,
}: {
  n: number
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="border-t border-neutral-900 pt-4">
      <div className="text-[0.65rem] tabular-nums text-neutral-600">
        0{n}
      </div>
      <h3 className="mt-1 text-sm font-medium text-neutral-100">{title}</h3>
      <p className="mt-1.5 text-[0.8rem] leading-relaxed text-neutral-500">
        {children}
      </p>
    </div>
  )
}

export interface LandingProps {
  onOpenStudio: () => void
}

export function Landing({ onOpenStudio }: LandingProps) {
  return (
    <div className="h-screen overflow-y-auto bg-neutral-950 font-sans text-neutral-100">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-sm font-semibold tracking-tight">Ballast</span>
        <button
          type="button"
          onClick={onOpenStudio}
          className="rounded border border-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-600 hover:text-neutral-100"
        >
          Open the studio
        </button>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-24">
        <section className="grid items-center gap-10 pt-10 pb-20 md:grid-cols-[1.15fr_1fr] md:pt-16">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-wind">
              Structural climate resilience
            </p>
            <h1 className="mt-4 text-4xl leading-[1.1] font-semibold tracking-tight text-neutral-50 md:text-5xl">
              Every kilogram that keeps a building standing costs the planet
              something.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-neutral-400">
              Ballast puts a structure in a real storm and asks you to make it
              survive — while counting what that safety costs in embodied
              carbon and in dollars. Move a slider and all three numbers move at
              once. That tension is the whole exercise.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onOpenStudio}
                className="rounded-md border border-wind/60 bg-wind/10 px-5 py-2.5 text-sm text-neutral-100 hover:bg-wind/20"
              >
                Open the studio
              </button>
              <a
                href="#physics"
                className="rounded-md px-3 py-2.5 text-sm text-neutral-500 hover:text-neutral-300"
              >
                How the numbers are made
              </a>
            </div>
          </div>
          <div className="flex justify-center md:justify-end">
            <BuildingDiagram />
          </div>
        </section>

        <section className="border-t border-neutral-900 py-16">
          <h2 className="text-xl font-medium tracking-tight text-neutral-100">
            Three numbers. No score.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">
            Anyone can make a building safe by making it heavier. The question
            worth asking a student is what they spent doing it. Ballast will not
            collapse safety, carbon and cost into a single rating, because a
            single rating is exactly where that question goes to die.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <Dial
              label="Safety factor"
              value="1.62"
              caption="Overturning and sliding, against a target of 1.50. Below it, the building is not standing up in the storm you chose."
              fill={0.93}
              colour={BAND_HEX.caution}
            />
            <Dial
              label="Embodied carbon"
              value="412 t"
              caption="A1–A3, structural frame only. Shown as a total and per square metre, because a taller building loses on totals and can still win on intensity."
              fill={0.62}
              colour={BAND_HEX.safe}
            />
            <Dial
              label="Cost"
              value="$1.4M"
              caption="Indicative rates per cubic metre. The weakest data in the project, and flagged as such on every single analysis."
              fill={0.55}
              colour={BAND_HEX.safe}
            />
          </div>
        </section>

        <section className="border-t border-neutral-900 py-16">
          <h2 className="text-xl font-medium tracking-tight text-neutral-100">
            How it works
          </h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            <Step n={1} title="Start with a structure">
              Six storeys of cross-laminated timber on a raft foundation. Change
              the height, the plan, the material and the lateral system —
              shear walls, a braced frame, a moment frame, or nothing at all.
            </Step>
            <Step n={2} title="Bring the weather">
              A three-second gust at your chosen exposure, resolved into a load
              on every storey. Watch the stack turn amber and then red from the
              ground up, where the accumulated shear is worst.
            </Step>
            <Step n={3} title="Redesign, and pay for it">
              Concrete buys stiffness and costs carbon. A wider base buys
              overturning resistance and costs floor area. Every dial carries
              its change against where you started.
            </Step>
          </div>
        </section>

        <section id="physics" className="border-t border-neutral-900 py-16">
          <h2 className="text-xl font-medium tracking-tight text-neutral-100">
            The numbers are not opinions
          </h2>
          <div className="mt-6 grid gap-10 md:grid-cols-2">
            <div className="space-y-4 text-sm leading-relaxed text-neutral-400">
              <p>
                Every value on screen comes out of a deterministic engine:
                ASCE 7-16 wind loads, storey stiffness and drift, overturning,
                sliding, and per-storey bending. No sampling, no estimation.
                Drag a slider back and you get the number you had before.
              </p>
              <p>
                Every coefficient carries either a clause reference or an
                explicit statement of how it was calibrated and against what.
                The test suite opens with a single-storey case worked by hand,
                all thirteen steps of the arithmetic written out in the file, so
                that changing a constant tells you exactly which step moved.
              </p>
              <p className="text-neutral-300">
                The language model reads those numbers and explains them. It
                never produces one — and that is not left to the prompt. Every
                reply is re-read by a guard that flags any figure which does not
                trace back to the engine output the model was given.
              </p>
            </div>
            <ul className="space-y-3 text-sm">
              {[
                ['Deterministic', 'Same design, same numbers, every time'],
                ['Cited', 'A clause reference behind every coefficient'],
                ['Checked', 'Model replies audited figure by figure'],
                ['Offline', 'The simulation needs no network at all'],
              ].map(([term, detail]) => (
                <li
                  key={term}
                  className="flex gap-4 border-t border-neutral-900 pt-3"
                >
                  <span className="w-28 shrink-0 text-neutral-200">{term}</span>
                  <span className="text-neutral-500">{detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-t border-neutral-900 py-16">
          <h2 className="text-xl font-medium tracking-tight text-neutral-100">
            And what it does not model
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">
            A teaching model that hides its assumptions teaches the wrong thing.
            These are the edges, and Ballast raises them as warnings on the
            analysis itself when a design walks past one.
          </p>
          <ul className="mt-6 grid gap-x-10 gap-y-3 text-[0.8rem] leading-relaxed text-neutral-500 sm:grid-cols-2">
            {[
              'Along-wind load only — no across-wind or torsional cases.',
              'A rigid building, which stops being true above about fifteen storeys.',
              'A flat site, with no topographic speed-up.',
              'Structural self-weight only; no superimposed dead or live load.',
              'Carbon is cradle-to-gate, frame only — a whole building is higher.',
              'Costs are indicative, not surveyed.',
            ].map((limit) => (
              <li key={limit} className="border-t border-neutral-900 pt-3">
                {limit}
              </li>
            ))}
          </ul>
        </section>

        <section className="border-t border-neutral-900 py-16 text-center">
          <h2 className="text-2xl font-medium tracking-tight text-neutral-100">
            Put a building in a storm.
          </h2>
          <button
            type="button"
            onClick={onOpenStudio}
            className="mt-6 rounded-md border border-wind/60 bg-wind/10 px-6 py-3 text-sm text-neutral-100 hover:bg-wind/20"
          >
            Open the studio
          </button>
        </section>
      </main>
    </div>
  )
}
