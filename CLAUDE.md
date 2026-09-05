# Resilience Studio

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
    analyze.ts         the single entry point; dispatches on hazard.kind
    index.ts           public surface
  (later) components/, store/, ai/, lib/supabase/
```

### Boundaries

- **Nothing in `src/engine/` may import React, zustand, Supabase, or anything
  outside the folder.** The only dependency is TypeScript itself. This is what
  makes the engine testable in milliseconds and portable to a worker or a
  server later.
- **The rest of the app imports from `@/engine` (i.e. `engine/index.ts`), never
  from a module inside it.** That keeps the internals free to change.
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

**ScoreCard is deliberately not a 0-100 score.** Collapsing safety, carbon and
cost into one number hides the tradeoff that is the entire point. Three raw
values plus a governing failure mode; the UI shows three dials.

---

## Commands

```
npm run dev         dev server
npm test            vitest, single run
npm run test:watch  vitest, watch mode
npm run coverage    coverage over src/engine
npm run typecheck   tsc -b --force
npm run build       typecheck + production build
```

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

---

## Build order

1. **Engine + scaffold** (done) — types, wind, stability, drift,
   sustainability, materials, tests.
2. 3D viewport — react-three-fiber, storeys coloured by `StoreyResult.utilization`.
3. Zustand store — structure editing, with `analyze()` derived, never stored.
4. AI critique panel — takes an `AnalysisResult` as context, returns prose.
5. Supabase — auth and saved designs.

Not built yet, by design: 3D, AI, Supabase.
