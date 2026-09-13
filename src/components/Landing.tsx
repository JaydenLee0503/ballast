/**
 * The front door.
 *
 * Ballast is a tool a fourteen year old should want to open, so the page is
 * warm paper, rounded blocks and short sentences. The studio wears the same
 * clothes — it is the same paper, ink and sticker shadows one step calmer,
 * because a panel is read for an hour and a landing page for a minute. This is
 * the box the game comes in, and they should look like they came from the same
 * shelf.
 *
 * The look is built from two ideas, in this order. Primary is *charming* —
 * chunky rounded shapes, sticker shadows, a pastel tower that leans a bit.
 * Secondary is *pixel*, used as seasoning: the small labels, the step numbers,
 * the clouds and the gust. Pixel is an accent here rather than the whole
 * costume, because a page rendered entirely in a pixel font is hard to read
 * and stops being charming about two paragraphs in.
 *
 * Everything the page claims, the engine also claims. The tower leans because
 * drift is real, the lower blocks are the loaded ones because storey shear
 * accumulates downward, and the "upfront about" list is the same set
 * `analyze()` raises as warnings. Nothing here is fetched: the illustration is
 * inline SVG and the fonts are self-hosted, so the page cannot come up wrong
 * because a CDN was slow.
 */

const INK = '#2f2748'

/**
 * One isometric block: a top rhombus and two side faces, on the usual 2:1
 * isometric grid where a half-width of `hw` gives a half-depth of `hw / 2`.
 * `y` is the centre of the top face, so a block stacks on the one below by
 * sitting at that block's `y` minus its own height.
 */
function Block({
  cx,
  y,
  hw,
  h,
  top,
  left,
  right,
}: {
  cx: number
  y: number
  hw: number
  h: number
  top: string
  left: string
  right: string
}) {
  const hh = hw / 2
  return (
    <g>
      <polygon
        points={`${cx},${y - hh} ${cx + hw},${y} ${cx},${y + hh} ${cx - hw},${y}`}
        fill={top}
      />
      <polygon
        points={`${cx - hw},${y} ${cx},${y + hh} ${cx},${y + hh + h} ${cx - hw},${y + h}`}
        fill={left}
      />
      <polygon
        points={`${cx + hw},${y} ${cx},${y + hh} ${cx},${y + hh + h} ${cx + hw},${y + h}`}
        fill={right}
      />
    </g>
  )
}

/**
 * The tower, bottom block first. It widens downward and leans downwind at the
 * top, which is what drift actually looks like — the storeys near the ground
 * carry every floor above them, so they are the ones being worked hardest.
 */
const TOWER = [
  { cx: 200, y: 300, hw: 110, h: 34, top: '#c3cdf9', left: '#9fabec', right: '#8794df' },
  { cx: 200, y: 268, hw: 98, h: 32, top: '#c6c4f7', left: '#a5a2ea', right: '#8f8bdd' },
  { cx: 202, y: 238, hw: 86, h: 30, top: '#cebef4', left: '#b09ee7', right: '#9a88da' },
  { cx: 205, y: 210, hw: 74, h: 28, top: '#d9bbf0', left: '#bd9be3', right: '#a785d6' },
  { cx: 210, y: 184, hw: 62, h: 26, top: '#e7b8ea', left: '#d097dc', right: '#ba81cf' },
  { cx: 218, y: 160, hw: 50, h: 24, top: '#f5b0df', left: '#e28fca', right: '#cf77b9' },
]

/** A chunky three-row pixel cloud, drawn on a grid of `s`-sized squares. */
function PixelCloud({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g fill="#ffffff" opacity="0.9">
      <rect x={x + 2 * s} y={y} width={3 * s} height={s} />
      <rect x={x + s} y={y + s} width={5 * s} height={s} />
      <rect x={x} y={y + 2 * s} width={7 * s} height={s} />
    </g>
  )
}

/** Pixel gust lines. Longer and denser near the top, where the wind is stronger. */
function PixelGust({ x, y, s, run }: { x: number; y: number; s: number; run: number }) {
  return (
    <g fill="#56c2ec">
      <rect x={x} y={y} width={run * s} height={s} />
      <rect x={x + (run + 2) * s} y={y} width={2 * s} height={s} />
    </g>
  )
}

function TowerScene() {
  return (
    <svg
      viewBox="0 0 400 400"
      className="h-auto w-full max-w-md"
      role="img"
      aria-label="An isometric tower of six stacked pastel blocks, widest at the bottom and leaning slightly at the top, with pixel-art clouds and wind gusts blowing against it."
    >
      <PixelCloud x={22} y={40} s={7} />
      <PixelCloud x={300} y={78} s={5} />

      {/* Gusts hit the upper storeys hardest, which is what the Kz profile says. */}
      <PixelGust x={26} y={140} s={6} run={7} />
      <PixelGust x={40} y={166} s={6} run={5} />
      <PixelGust x={30} y={196} s={6} run={4} />

      {/* Ground shadow, flattened to sit on the isometric plane. */}
      <ellipse cx="200" cy="352" rx="128" ry="26" fill={INK} opacity="0.08" />

      {TOWER.map((block) => (
        <Block key={block.y} {...block} />
      ))}
    </svg>
  )
}

function PixelRule() {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {['bg-coral', 'bg-blossom', 'bg-lilac', 'bg-bloom', 'bg-mint'].map((tone) => (
        <span key={tone} className={`size-2 ${tone}`} />
      ))}
    </div>
  )
}

/** A card with a hard offset shadow — a sticker rather than a floating pane. */
function Card({
  tone,
  title,
  children,
  tilt,
}: {
  tone: string
  title: string
  children: React.ReactNode
  tilt: string
}) {
  return (
    <div
      className={`rounded-2xl border-[3px] border-ink bg-white p-5 shadow-[5px_5px_0_0_var(--color-ink)] ${tilt}`}
    >
      <span className={`inline-block size-5 rounded-md border-2 border-ink ${tone}`} />
      <h3 className="mt-3 font-display text-lg text-ink">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink/70">{children}</p>
    </div>
  )
}

function Step({
  n,
  title,
  children,
}: {
  n: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <span className="font-pixel text-3xl text-coral">{n}</span>
      <h3 className="mt-1 font-display text-lg text-ink">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink/70">{children}</p>
    </div>
  )
}

export interface LandingProps {
  onOpenStudio: () => void
}

export function Landing({ onOpenStudio }: LandingProps) {
  return (
    <div className="h-screen overflow-y-auto bg-paper font-body text-ink">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="font-display text-xl tracking-tight">Ballast</span>
        <button
          type="button"
          onClick={onOpenStudio}
          className="rounded-full border-[3px] border-ink bg-white px-4 py-1.5 font-display text-sm shadow-[3px_3px_0_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
        >
          Start building
        </button>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-20">
        <section className="grid items-center gap-8 pt-6 pb-16 md:grid-cols-[1.1fr_1fr] md:pt-12">
          <div>
            <p className="font-pixel text-sm tracking-widest text-bloom">
              STACK → DISASTER → REBUILD
            </p>
            <h1 className="mt-3 font-display text-4xl leading-[1.08] text-ink md:text-6xl">
              Build a tower.
              <br />
              Then try to knock it over.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-ink/75">
              Ballast is a workshop for things that have to stay standing. Stack
              up floors, then throw a storm, an earthquake or a flood at it and
              watch the whole thing happen. Then make it tougher — without
              costing the earth.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onOpenStudio}
                className="rounded-full border-[3px] border-ink bg-coral px-7 py-3 font-display text-lg text-white shadow-[5px_5px_0_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
              >
                Start building
              </button>
              <a
                href="#how"
                className="rounded-full px-4 py-3 font-display text-base text-ink/60 hover:text-ink"
              >
                How does it work?
              </a>
            </div>
          </div>
          <div className="flex justify-center md:justify-end">
            <TowerScene />
          </div>
        </section>

        {/* Three hazards, named by what they do rather than by the clause they
            come from. The consequence is the lesson; the citations are in the
            studio, beside the numbers they produced. */}
        <section className="rounded-3xl border-[3px] border-ink bg-white px-6 py-10 shadow-[6px_6px_0_0_var(--color-ink)] md:px-10">
          <PixelRule />
          <h2 className="mt-4 font-display text-2xl text-ink md:text-3xl">
            Pick your disaster
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink/75">
            Storm, earthquake or flood — and they are not the same problem
            wearing different hats. A tall light tower shrugs off a flood and is
            the easiest thing in the world for an earthquake to throw around.
            Build one building, run it against all three, and the tradeoffs stop
            being abstract.
          </p>
          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            <Card tone="bg-mint" title="Storm" tilt="-rotate-1">
              Pushes hardest at the top, where the air moves fastest. Be narrow,
              be stiff, and do not present a wide flat face to it.
            </Card>
            <Card tone="bg-blossom" title="Earthquake" tilt="rotate-1">
              Shakes the ground, and your building has to drag its own weight
              along. Heavy is suddenly the problem, not the answer.
            </Card>
            <Card tone="bg-lilac" title="Flood" tilt="-rotate-1">
              Leans on the bottom few metres and tries to float the rest. Light
              buildings are the ones that lift off their foundations.
            </Card>
          </div>
          <p className="mt-6 text-sm leading-relaxed text-ink/70">
            Then press <span className="font-display text-ink">Start a
            simulation</span> and watch it arrive: the building leans, shakes or
            goes under, floors crack, and anything past its limit comes down.
            Afterwards you are back at the controls with the damage explained.
          </p>
        </section>

        <section className="mt-16 rounded-3xl border-[3px] border-ink bg-bloom/15 px-6 py-10 md:px-10">
          <PixelRule />
          <h2 className="mt-4 font-display text-2xl text-ink md:text-3xl">
            Three things to juggle
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink/75">
            You can make almost anything survive a storm if you throw enough
            concrete at it. The trick is doing it without wrecking your budget
            or the planet. Ballast keeps all three on screen at once and never
            squashes them into a single score — that is exactly where the
            interesting part disappears.
          </p>
          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            <Card tone="bg-mint" title="Will it stand up?" tilt="-rotate-1">
              How much stronger your tower is than the disaster you picked. Dip
              under 1.5 and it is in real trouble.
            </Card>
            <Card tone="bg-lilac" title="What did the planet pay?" tilt="rotate-1">
              The carbon baked into every beam and slab you used. Concrete is
              strong and expensive in exactly this way.
            </Card>
            <Card tone="bg-blossom" title="What did you pay?" tilt="-rotate-1">
              Materials cost money too. The cheapest tower and the greenest
              tower are almost never the same tower.
            </Card>
          </div>
        </section>

        <section id="how" className="py-16">
          <PixelRule />
          <h2 className="mt-4 font-display text-2xl text-ink md:text-3xl">
            How it works
          </h2>
          <div className="mt-8 grid gap-8 sm:grid-cols-3">
            <Step n="01" title="Stack your floors">
              Pick how tall and how wide, then choose what it is made of —
              timber, steel, concrete, bamboo, even rammed earth.
            </Step>
            <Step n="02" title="Choose a disaster">
              A storm, an earthquake or a flood — then how bad, and which way it
              comes from. Each one loads your building somewhere different.
            </Step>
            <Step n="03" title="Watch it happen">
              Run the simulation. Floors glow amber, then red, then crack when
              they are past their limit — and you find out what you have to
              change.
            </Step>
          </div>
        </section>

        <section className="rounded-3xl border-[3px] border-ink bg-white px-6 py-10 shadow-[6px_6px_0_0_var(--color-ink)] md:px-10">
          <PixelRule />
          <h2 className="mt-4 font-display text-2xl text-ink md:text-3xl">
            These are real numbers
          </h2>
          <div className="mt-5 grid gap-8 md:grid-cols-[1.3fr_1fr]">
            <div className="space-y-4 text-sm leading-relaxed text-ink/75">
              <p>
                Every number in Ballast comes out of the same equations a
                structural engineer would use — wind pressure, how far each
                floor sways, whether the whole thing tips over. Nothing is
                guessed and nothing is random. Slide the storm back down and you
                get the number you had before. The animation is allowed to
                exaggerate how far things move, and says so while it does; it is
                never allowed to decide what breaks.
              </p>
              <p>
                There is an AI helper that explains what is going wrong and
                suggests things to try. It is not allowed to invent numbers —
                and we do not simply trust it on that. Every answer it gives is
                checked against the engine first, and anything that does not
                match is flagged before it reaches you.
              </p>
            </div>
            <ul className="space-y-2.5">
              {[
                [
                  'Real equations',
                  'ASCE 7 wind, seismic and flood loads, cited clause by clause',
                ],
                ['Same every time', 'No dice rolls anywhere in the maths'],
                ['The AI cannot fib', 'Its answers are audited figure by figure'],
                ['Works offline', 'The simulation needs no internet at all'],
              ].map(([term, detail]) => (
                <li
                  key={term}
                  className="rounded-xl border-2 border-ink/15 bg-paper px-3 py-2"
                >
                  <span className="font-display text-sm text-ink">{term}</span>
                  <span className="block text-xs text-ink/60">{detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="py-16">
          <PixelRule />
          <h2 className="mt-4 font-display text-2xl text-ink md:text-3xl">
            Stuff we are upfront about
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink/75">
            Ballast is for learning, not for signing off a real building. A
            model that hides its limits teaches the wrong lesson, so here is
            where ours stops — and it says so on screen when you walk past one.
          </p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {[
              'Everything hits from one direction at a time.',
              'Towers past about fifteen floors get less accurate.',
              'Carbon counts the frame, not the whole finished building.',
              'Prices are ballpark figures, not real quotes.',
              'The ground is flat — no hills to speed the wind up.',
              'Floods here are rivers, not coastal surges: no breaking waves.',
              'Earthquakes shake sideways only, and only one way at a time.',
              'Wildfire is not in here at all. It is the next one.',
            ].map((limit) => (
              <li
                key={limit}
                className="rounded-xl border-2 border-ink/15 px-4 py-3 text-sm leading-relaxed text-ink/70"
              >
                {limit}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-3xl border-[3px] border-ink bg-coral/15 px-6 py-14 text-center">
          <h2 className="font-display text-3xl text-ink md:text-4xl">
            Got a tower in mind?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink/70">
            No account, no download. It opens straight into the studio.
          </p>
          <button
            type="button"
            onClick={onOpenStudio}
            className="mt-7 rounded-full border-[3px] border-ink bg-coral px-8 py-3.5 font-display text-lg text-white shadow-[5px_5px_0_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
          >
            Start building
          </button>
        </section>

        <p className="pt-10 text-center font-pixel text-xs tracking-widest text-ink/40">
          BALLAST · BUILT FOR PEOPLE WHO LIKE KNOCKING THINGS DOWN
        </p>
      </main>
    </div>
  )
}
