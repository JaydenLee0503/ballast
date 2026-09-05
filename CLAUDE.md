# Ballast

A browser-based 3D simulator where students take a structure, subject it to a
real climate hazard, and redesign it to survive while minimising embodied
carbon and cost. The carbon / cost / safety tradeoff is the product, not a
footnote on it.

---

## The one rule

**The engine computes. The AI explains.**

Every number a student sees — safety factor, base shear, drift, kilograms of
CO2e, dollars — comes from `src/engine/`, a pure deterministic module. The
language model reads those numbers and critiques, explains and suggests. It
never produces one.

If you find yourself about to write a prompt that asks a model to estimate,
score, rate, or "calculate" anything, stop. The correct move is to add a
function to the engine and pass its output into the prompt as context.

Why this is non-negotiable:

- **Reproducibility.** A student who moves a slider back must see the number
  they saw before. Sampling breaks that.
- **Defensibility.** Every value traces to a formula and a cited coefficient.
  "The model said 1.4" is not a structural argument.
- **It is the demo.** A climate-resilience tool whose physics is vibes is a
  toy. The deterministic engine is the thing worth showing a judge.

The AI layer's legitimate jobs: explaining *why* a storey is red, proposing
design changes to try, narrating the tradeoff between the three dials, and
turning a ScoreCard into prose a first-year student understands.

And the rule is not left to the prompt alone. `ai/guard.ts` re-reads every
reply and flags any figure that does not trace back to the context the model
was given. See "The AI layer" below.

---

## Architecture

```
src/
  engine/          pure simulation. no React, no I/O, no randomness.
    types.ts           domain types + result shapes
    constants.ts       every code coefficient and calibration factor, cited
    data/
      materials.json   seed library, one `sources` citation per number
    materials.ts       library loading + validation
    wind.ts            ASCE 7-style wind loads
    drift.ts           storey stiffness and drift
    stability.ts       overturning, sliding, per-storey bending
    sustainability.ts  quantity take-off -> carbon and cost
    compare.ts         two AnalysisResults -> per-metric deltas and direction
    analyze.ts         the single entry point; dispatches on hazard.kind
    index.ts           public surface
  store/
    design.ts          zustand: structure + hazard + baseline + selection
    useAnalysis.ts     the bridge: analyze() memoised on (structure, hazard)
    useComparison.ts   the same, for the baseline, then compareDesigns()
    sharedDesign.ts    opens a design out of the URL fragment, at boot
    useAppView.ts      landing vs studio, on the URL hash
  persistence/
    schema.ts          the saved-design format, and the parser that guards it
    library.ts         DesignLibrary + the localStorage implementation
    share.ts           a design encoded into a link
    index.ts           public surface
  components/
    Landing.tsx        the front door; "Open the studio" leads here
    Viewport.tsx       r3f canvas, lighting, camera, legend
    scene/
      StoreyStack.tsx  one box per storey, coloured by utilization
      WindArrows.tsx   per-storey arrows, length from lateralForce_kN
      World.tsx        sky, sun, streets, trees, traffic, neighbours
      scenery.ts       the deterministic layout of all of that
    ScorePanel.tsx     the three dials + governing failure mode
    StoreyTable.tsx    per-storey breakdown, selectable rows
    DesignControls.tsx every slider and select
    SavedDesigns.tsx   save, reopen, share
  ai/
    types.ts           CritiqueContext + Critique. no imports, by design
    context.ts         AnalysisResult -> the facts the model may see
    prompt.ts          the system rules + the facts, as messages
    parse.ts           tolerant JSON extraction from the reply
    guard.ts           flags figures that do not trace back to the context
    client.ts          POSTs to /api/critique, then parses and guards
  lib/
    orbit.ts           rigid camera rotation about an arbitrary pivot
    palette.ts         utilisation colour bands (source of truth for colour)
    sky.ts             building height -> time of day, as a pure palette
    format.ts          display formatting only; no arithmetic that means anything
    limits.ts          editing bounds, shared by the controls and the parser
plugins/
  critiqueApi.ts       /api/critique on the dev + preview server. holds the key
  (later) persistence/supabase.ts   a second DesignLibrary, behind auth
```

### Boundaries

- **Nothing in `src/engine/` may import React, zustand, Supabase, or anything
  outside the folder.** The only dependency is TypeScript itself. This is what
  makes the engine testable in milliseconds and portable to a worker or a
  server later.
- **The rest of the app imports from `@/engine` (i.e. `engine/index.ts`), never
  from a module inside it.** The same rule holds for `@/persistence`, which is
  what lets a Supabase adapter land behind `DesignLibrary` without a call site
  changing. That keeps the internals free to change. The `@`
  alias is configured in both `vite.config.ts` and `tsconfig.app.json`; keep
  them in step.
- **Engine results are derived, never stored.** `useAnalysis()` recomputes
  `analyze()` from `(structure, hazard)` and memoises on object identity. That
  works only because every store action replaces the structure rather than
  mutating it. Caching a ScoreCard in the store would give the app two sources
  of truth for a safety factor, and the stale one would be the one on screen.
- `analyze(structure, hazard, library)` is the whole API. If a component needs
  a number, it comes from an `AnalysisResult`.

### Extension points

- **New hazards** join the `Hazard` discriminated union with their own `kind`,
  and `analyze()` gains a `case`. Seismic, flood and wildfire were designed for
  from the start; no call site changes when they arrive.
- **New materials** are rows in `data/materials.json`. Every numeric field
  needs a matching entry in `sources`.

---

## Conventions

- **Units live in identifiers.** `height_m`, `baseShear_kN`,
  `embodiedCarbon_kgCO2e_m3`. A field without a unit suffix is dimensionless,
  and says so in a comment. This is the cheapest possible defence against the
  class of bug that loses spacecraft.
- **SI internally, always.** Convert at the boundary (`kmhToMs`), never in the
  middle of a formula.
- **Every constant is cited or calibrated.** `constants.ts` has no bare
  numbers. Either a clause reference (`ASCE 7-16 Table 26.10-1`) or an
  explicit statement of how the value was tuned and against what.
- **Assumptions are written down where they bite**, in a comment above the
  formula they affect, not in a doc nobody opens.
- **`storeys[0]` is the ground storey.** The array reads bottom to top.
- TypeScript is strict, with `noUncheckedIndexedAccess` on — the engine indexes
  lookup tables by string key and the compiler should say so.

---

## Modelling decisions worth knowing

These are the places where the engine is deliberately simple. All are
documented in situ; this is the index.

| Decision | Where | Why it matters |
|---|---|---|
| Structural volume = gross volume x a fraction per material class and lateral system | `constants.ts` `STRUCTURAL_FRACTION` | Sets the absolute scale of every carbon and cost number |
| Storey stiffness `k = C_sys * E * A_plan / h`, `C_sys` empirically calibrated | `constants.ts` `LATERAL_STIFFNESS_COEFFICIENT` | The biggest tuning knob in the engine. Scales with `A`, not `B*L^3`, so slender towers are under-penalised |
| Rigid building, `G = 0.85` | `constants.ts` `G_GUST_EFFECT` | Wrong above ~15 storeys; `analyze()` warns |
| Flat site, `Kzt = 1.0` | `constants.ts` `KZT_TOPOGRAPHIC` | No topographic speed-up modelled |
| `exposureCategory` governs Kz; `terrainRoughness` is only a consistency check | `wind.ts` `checkRoughnessConsistency` | Keeps Kz traceable to one ASCE clause instead of an invented blend |
| Only along-wind load case | `wind.ts` header | No across-wind or torsional cases |
| Structural self-weight only; no superimposed dead or live load | `stability.ts` | Conservative for overturning, and it is what makes the slenderness lesson land |
| Section modulus smears material across the plan | `stability.ts` `effectiveSectionModulus_m3` | Conservative by ~2x; fine for relative utilisation, not for member sizing |
| Carbon is A1-A3, frame only, no sequestration | `sustainability.ts` header | A whole-building figure would be much higher |
| Costs are indicative, not surveyed | `data/materials.json` | Flagged as a warning on every analysis. The weakest data in the project |

---

## The AI layer

`analyze()` produces the numbers; this layer produces sentences about them.

**The flow.** `context.ts` turns an `AnalysisResult` into a `CritiqueContext`
-- a flat sheet of already-rounded facts, plus the material library so
suggestions stay buildable. `prompt.ts` renders that into a system turn (the
rules) and a user turn (the facts). `plugins/critiqueApi.ts` calls the
provider. `parse.ts` recovers the JSON. `guard.ts` checks it. Every step
except the network call is pure and tested.

**Rounding happens once, in `context.ts`.** The model quotes those values and
the guard checks against those values, which is what makes "did it quote us
correctly?" a decidable question rather than a floating-point argument.

**The guard is unit-scoped.** A claimed force is compared only against forces,
a claimed cost only against costs. Units are derived from field names, which
is why `CritiqueContext` follows the unit-suffix convention as strictly as the
engine does -- rename `carbon_kgCO2e` to something tidier and you silently
move it into the unverifiable bucket. `context.test.ts` asserts that only the
genuinely dimensionless fields land there.

Its limits, honestly: it only inspects figures with a unit, an `h/N` drift
ratio, or a stated safety factor, so an invented bare number in prose passes.
Tolerance is 0.5% relative, so an invention within 0.5% of a real value of the
same dimension passes. Both are deliberate -- a guard that cried wolf would be
turned off.

**The key never reaches the browser.** The provider variables are read in
`vite.config.ts` via `loadEnv(mode, cwd, '')` and handed to the plugin. They
are deliberately not `VITE_`-prefixed, because that prefix is exactly what
would inline them into the bundle.

**Provider.** Featherless (`https://api.featherless.ai/v1`), which is
OpenAI-compatible, so the call is a plain `fetch` and there is no SDK
dependency. Model id lives in `.env`; there is no default, because a silent
fallback to a model you did not choose is worse than an error. Pointing at any
other OpenAI-compatible provider is a `FEATHERLESS_BASE_URL` change.

**`/api/critique` is dev and preview only.** It is a Vite middleware, not a
production server. Deploying means moving those three steps -- build messages,
call provider, return text -- into a serverless or edge function.
`buildMessages` is pure and shared, so that is a transport change and nothing
else.

---

## Saved designs

`persistence/` is a format, a parser and a place to put things. Supabase will
be a second place; nothing above it should be able to tell.

**A saved design is untrusted input.** It may come from an older build, a
hand-edited devtools entry, a link a student pasted, or later a row another
client wrote. The engine has no tolerance for a bad structure — `analyze()`
throws — and the whole UI hangs off one analysis, so a bad load does not
corrupt a corner of the app, it replaces the app with an error page. Hence two
rules in `schema.ts`:

- **Parse, don't cast.** `parseDesign` builds a new object out of values it has
  checked, one field at a time. It never asserts a type onto its input, so a
  payload's extra properties die at the boundary instead of riding into React
  state and back out to storage on the next save.
- **Reject, don't repair.** An unknown material is refused *by name*, not
  silently swapped for concrete. Substituting would hand a student a carbon
  number for a building they did not design — the same failure as an invented
  number, arriving from a different direction.

`schema.test.ts` ends with the property the module exists for: anything the
parser accepts, `analyze()` can run.

**One set of bounds.** `lib/limits.ts` holds the editing limits, and both the
controls and the parser read them. If persistence had its own numbers, a saved
file could restore a state the sliders can no longer express — 40 storeys on a
control that stops at 24, with no way back.

**`DesignLibrary` is async, though localStorage is not.** A synchronous
interface would be honest about this backend and wrong about the next one, and
the cost of finding that out later is every call site changing at the moment a
network appears. Every method is declared `async` rather than merely
Promise-returning, so a failure cannot escape a caller's `.catch()` as a
synchronous throw.

**Storage is one key per design**, `ballast.design.<id>`. It costs a
key scan on `list()` and buys two things: a save rewrites one entry rather than
all of them, and one corrupt record loses one design instead of the library. An
unreadable record is skipped and left in place — a later version may be able to
read what this one cannot.

**Share links carry the design.** The payload is the same `SavedDesign`,
base64url in the URL *fragment*, validated by the same parser — no second
format and no second set of rules. Fragments are not sent to the server, so a
student's work stays out of access logs. This is also the half of "saved
designs" that needs no backend at all: a classroom can pass designs around
before Supabase exists, and during a demo if the network does not cooperate.
Measured sizes are in `share.ts` and pinned in `share.test.ts`.

The link is consumed in `main.tsx`, before React renders, not in an effect —
otherwise the default building paints first and swaps a frame later. The
fragment is cleared either way: on success because the URL should describe
where the student is now, on failure so a refresh does not reproduce it.

---

## The landing page

Ballast is a tool a fourteen year old should want to open, so the landing page
is warm paper, rounded blocks and short sentences while the studio is a dark
instrument panel. They deliberately do not match: this is the box the game
comes in, and the studio is the game.

**Two ideas, in this order.** Primary is *charming* — chunky rounded shapes,
sticker shadows (hard offset, no blur), a pastel isometric tower that leans.
Secondary is *pixel*, used as seasoning: small labels, step numbers, the clouds
and the gust. Pixel is an accent rather than the whole costume, because a page
set entirely in a pixel font stops being readable, and stops being charming,
about two paragraphs in.

**The landing palette is separate tokens from the utilisation colours**
(`--color-paper` / `--color-ink` / `--color-coral` / … versus
`--color-safe` / `--color-caution` / `--color-fail`). A restyle of the front
door must never be able to change what "over the limit" looks like in the
studio. Fonts are Fredoka (display), Nunito (body) and Pixelify Sans (accent),
**self-hosted in `public/fonts`** — about 57 kB — for the same reason the scene
has no drei `<Environment>`: nothing should need the network to look right
during a demo.

**Everything the page claims, the engine also claims.** The tower leans because
drift is real, the lower blocks are the loaded ones because storey shear
accumulates downward, and "stuff we are upfront about" is the same list
`analyze()` raises as warnings. Overselling a teaching model is the fastest way
to make it untrustworthy the moment somebody opens it, which is why the limits
are a section on the front page rather than a footnote inside the app.

`#studio` in the hash means the studio; anything else means the landing page.
Hash-based rather than a router — one boolean of navigation does not justify a
dependency, and a hash needs no server rewrite rule, which matters for a thing
that has to run off a static host or a demo laptop. The hash is pushed, not
replaced, so Back returns here. A share link skips the landing entirely:
whoever followed it was sent a building, not an invitation to read the pitch.

---

## UI conventions

- **Coordinate mapping.** The engine works in plan X/Y with height separate;
  three.js is Y-up. So `widthX_m -> three X`, `widthY_m -> three Z`,
  `height_m -> three Y`. Get it wrong and the building looks right while the
  wind hits the wrong face.
- **Colour has one home.** `BAND_HEX` in `lib/palette.ts` is the source of
  truth — three.js cannot parse the `oklch()` the Tailwind theme would prefer,
  so the `@theme` block in `index.css` mirrors those hex values and says so.
  Three discrete bands, not a ramp, so a shaded 3D box and a table cell mean
  the same thing.
- **The viewport invents nothing.** Every colour and every arrow length reads
  a field off `AnalysisResult`. Wind arrows are normalised against the largest
  storey force, so they show the *shape* of the load; magnitude is the panel's
  job.
- **Rotation is about the point under the cursor**, and it is ours, not
  OrbitControls'. Its model makes `target` both the pivot and the centre of the
  screen — `update()` ends in `lookAt(target)` — so moving the target onto the
  cursor point yanks that point to the middle. Instead `lib/orbit.ts` rotates
  the whole rig rigidly about the cursor point: rotating a camera about P
  leaves P at the same camera-space coordinates, so it stays on the same pixel
  and nothing jumps. `target` is rotated by the same quaternion, which keeps
  the rig rigid and lets OrbitControls keep pan, dolly, damping and
  `zoomToCursor` — only `enableRotate` is handed over. `orbit.test.ts` asserts
  the pinning property against a real projection matrix, including across a
  long drag applied one event at a time, where error would accumulate rather
  than cancel.
- **No runtime asset fetches in the scene.** No drei `<Environment>` and no
  drei `<Text>` — both pull from a CDN, which would make the viewport depend
  on the network during a demo. Lighting is local, labels are HTML. The same
  rule shapes the world around the building: the sky is a two-colour gradient
  shader, the lit windows after dark are a hash in a fragment shader, and the
  star field is 900 seeded directions. No textures, no HDRIs, nothing to fail
  on venue wifi.
- **The building stands in a city, and the city means nothing.** `scene/`
  renders two layers and the line between them is load-bearing. The *design* —
  `StoreyStack` and `WindArrows` — is engine output and only engine output.
  The *world* — `World.tsx` over the layout in `scenery.ts` — is streets,
  pavements, street trees, parked cars, neighbouring blocks and a sky. None of
  it reads an `AnalysisResult` and none of it feeds one; its only input is the
  design's total height, which is something the student typed rather than
  something the engine derived. It earns its place by supplying scale: 40 m
  means nothing beside an empty grid and a great deal beside four-storey
  walk-ups and a road with cars on it. The neighbours are deliberately
  desaturated, so the only saturated colours on screen are still the ones that
  mean something. This replaced the infinite reference grid — a street with a
  car on it is a better ruler than a 1 m grid, and it needs no explaining.
- **The scenery never moves.** `scenery.ts` generates the whole neighbourhood
  once, at module load, from a fixed seed — not `Math.random`, and not from
  anything in the store. A city that reshuffled itself as a slider moved would
  read as output, which is the one thing it must not be.
- **The sky darkens as the tower climbs.** `lib/sky.ts` maps total height to a
  time of day: midday, afternoon, golden hour, dusk, then night with the
  neighbourhood's windows lit. It is the world's only feedback, and it is a
  pure tested function — `sky.test.ts` asserts the claim the effect makes, that
  brightness, key-light intensity and star opacity all move one way with
  height. The sun sinks with it but keeps its bearing, so the building's shadow
  lengthens instead of swinging across the plot as storeys are added, and it
  stops short of the horizon because a shadow camera's ground footprint grows
  as 1/sin(elevation) and the shadow map runs out of texels first.
- **Flat things at ground level are stacked with `polygonOffset`, not with
  millimetres.** Grass, carriageway, lane markings and the site pad all sit at
  y = 0. Depth precision at the far end of a 0.1 m near plane is coarser than
  the gaps a stack of road markings wants, so height offsets that look right up
  close shimmer as soon as the camera pulls back to frame a tall building.
- **A long lens, deliberately.** The camera is 34 degrees, not the usual 45-50.
  Flattened perspective is what makes a scene read as a model of a place rather
  than a photograph of one, and the model is the thing being taught.
- **Carbon and cost are shown as totals and per m2.** Totals alone cannot
  compare a six-storey design with a twelve-storey one. `grossFloorArea_m2()`
  is in the engine so the denominator is traceable too.

---

## The baseline

Three absolute dials tell a student where they are. They do not tell them what
the last twenty minutes of work bought, and that is the lesson: not "carbon is
412 t" but "40% more safety for 18% more carbon". The tradeoff is only visible
against something.

So every dial carries its change against a baseline, and **the deltas come from
`engine/compare.ts`, not from subtraction in the panel**. A percentage on
screen is a number a student will quote; doing the arithmetic in a component
would put an untraceable figure next to traceable ones. `compareDesigns`
reports direction per metric and deliberately refuses to total them into a
verdict, for the same reason ScoreCard is not a 0-100 score.

The degenerate cases are the ones that matter, because they are one slider drag
away. A safety factor is legitimately infinite and a drift ratio legitimately
zero at 0 km/h, so a relative change is `null` — reported as an em dash — where
a naive ratio would print `Infinity%` on the easiest input in the app to reach.

The baseline starts as the design the studio opens with, can be pinned to
whatever is on screen, and **follows a design that gets opened**: after opening
someone else's work the useful question is "what did *my* changes do", not "how
does this differ from a default they never saw".

Not yet done, and the obvious next move: hand the comparison to the critique as
context, so the model can talk about the direction a student is heading rather
than only where they are. It needs unit buckets in `ai/guard.ts` for the new
figures first — see the guard's note about renaming fields.

---

**ScoreCard is deliberately not a 0-100 score.** Collapsing safety, carbon and
cost into one number hides the tradeoff that is the entire point. Three raw
values plus a governing failure mode; the UI shows three dials.

---

## Commands

```
npm run dev         dev server (also serves /api/critique)
npm test            vitest, single run
npm run test:watch  vitest, watch mode
npm run coverage    coverage over src/engine
npm run typecheck   tsc -b --force
npm run build       typecheck + production build
```

### Environment

Copy `.env.example` to `.env` and fill in `FEATHERLESS_API_KEY` and
`FEATHERLESS_MODEL`. Without them the app runs fine and the critique panel
returns a message telling you which one is missing. `.env` is gitignored;
`.env.example` is not.

### WSL / Windows drive note

This repo lives on `/mnt/d`, a 9p drvfs mount that does not permit symlinks, so
`npm install` cannot create `node_modules/.bin`. Two consequences:

- **Install with `npm install --no-bin-links`.** A plain `npm install` fails
  with `EPERM ... operation not permitted` on the `.bin` symlinks.
- **`package.json` scripts call entrypoints directly** (`node
  ./node_modules/vite/bin/vite.js`) rather than relying on `.bin` shims.

Moving the repo onto the WSL filesystem (`~/`) would remove both constraints
and be considerably faster; the current setup works as-is.

---

## Testing

The engine is the part that must not rot, so it is the part with tests.

- `analyze.test.ts` opens with a **fully hand-calculated single-storey case**,
  with all thirteen steps of arithmetic written out in the file header. Change
  a coefficient and this test tells you exactly which step moved.
- Property-style tests guard the invariants that spot-checks miss: base shear
  monotonic in gust speed, `V^2` scaling, overturning safety monotonic in base
  width.
- `wind.test.ts` checks the hand-transcribed ASCE Kz table against the power
  law it discretises, so a typo cannot survive.
- A material with an unresolved `TODO` (null) throws rather than scoring as
  zero. A missing carbon figure must never make the least-documented material
  look like the greenest one.
- `lib/sky.test.ts` holds the scenery to its one claim: brightness, key-light
  intensity and star opacity are monotonic in building height, and the sun
  never drops below the horizon. Colours are 8-bit, so the fine sweep allows
  one rounding level and a coarse sweep is strict.
- `ai/guard.test.ts` is written from the attacker's side: what could a model
  say that is wrong and still slip through? It covers invented forces,
  invented safety factors, predicted outcomes, and the dimension-confusion
  case where a material density would otherwise excuse a fabricated base
  shear.
- `ai/prompt.test.ts` asserts the hard rules are still in the system prompt,
  so softening them fails the suite rather than quietly changing behaviour.
- `persistence/schema.test.ts` is the same attacker framing applied to stored
  data: wrong schema version, unknown material, absurd dimensions, a numeric
  string, a hazard kind from a future build. It closes with the property the
  parser exists to hold — everything it accepts, `analyze()` can run.
- `persistence/library.test.ts` runs against a fake `Storage` rather than
  jsdom, which keeps the suite in the node environment and lets a test make
  storage misbehave on demand: throw on read, throw on write, hold a corrupt
  value. That is the interesting half of the behaviour, and a real
  localStorage will not do it when asked.

---

## Build order

1. **Engine + scaffold** (done) — types, wind, stability, drift,
   sustainability, materials, tests.
2. **3D viewport** (done) — react-three-fiber, storeys coloured by
   `StoreyResult.utilization`, wind arrows from `lateralForce_kN`.
3. **Zustand store** (done) — structure editing, with `analyze()` derived,
   never stored.
4. **AI critique panel** (done) — takes an `AnalysisResult` as context,
   returns prose, and every figure it quotes is checked against that context.
5. **Saved designs** (done) — a validated format, a `DesignLibrary` backed by
   localStorage, and share links that carry a design in the URL.
6. Supabase — auth, and a second `DesignLibrary` so designs follow an account
   between browsers. The interface it has to satisfy already exists.

Also outstanding: a production transport for `/api/critique`, and streaming
(the reply currently arrives in one go).

Known and accepted: the production bundle is ~1.1 MB (three.js). Code-split it
only if load time actually becomes a problem.
