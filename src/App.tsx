/**
 * Application shell: the model on the left, the numbers on the right.
 *
 * The two panes are the same data. Colours in the viewport and percentages in
 * the table both come from `StoreyResult.utilization`, so a student can move
 * between "which bit is red" and "why" without a translation step. This is
 * the only place `useAnalysis()` is called; everything below takes the result
 * as a prop, which keeps one analysis per render and makes it obvious that
 * nothing else is computing numbers of its own.
 *
 * The chrome is the landing page's: warm paper, ink outlines, sticker shadows,
 * Fredoka for headings and the pixel face for the small labels. It used to be
 * a dark instrument panel, which was right when the viewport was boxes on an
 * empty grid and wrong the moment the viewport became a daylit city — black
 * chrome around it read as a hole cut in the page. The box and the game look
 * like one object now.
 *
 * The panel folds away, because the model is the thing worth looking at and
 * sometimes a student wants all of the screen for it. Folding is a layout
 * change and nothing else: the panel keeps its state and its scroll position,
 * and the analysis it is showing goes on being recomputed, so unfolding is
 * instant rather than a reload.
 */

import { useState } from 'react'
import { BlueprintPanel } from '@/components/BlueprintPanel.tsx'
import { CritiquePanel } from '@/components/CritiquePanel.tsx'
import {
  AdvancedControls,
  BasicControls,
} from '@/components/DesignControls.tsx'
import { Landing } from '@/components/Landing.tsx'
import { SavedDesigns } from '@/components/SavedDesigns.tsx'
import { ScorePanel } from '@/components/ScorePanel.tsx'
import { StoreyTable } from '@/components/StoreyTable.tsx'
import { Viewport } from '@/components/Viewport.tsx'
import { Bo } from '@/components/tutorial/Bo.tsx'
import { TutorialTour } from '@/components/tutorial/TutorialTour.tsx'
import { useDesignStore } from '@/store/design.ts'
import { useAnalysis } from '@/store/useAnalysis.ts'
import { useAppView } from '@/store/useAppView.ts'
import { useComparison } from '@/store/useComparison.ts'
import { sharedDesignOutcome } from '@/store/sharedDesign.ts'
import { useTutorialStore } from '@/store/useTutorial.ts'
import { stepAt } from '@/lib/tutorial.ts'
import { HAZARD_LABEL, HAZARD_PROVENANCE } from '@/lib/hazard.ts'

/**
 * The panel's tabs, in the order a session actually goes: build the thing,
 * then refine it, then keep it, then ask about it.
 *
 * Basics and Advanced are one control set split by how much you have to know
 * to use it, not by what it touches — see `DesignControls.tsx`. Nothing is
 * hidden that the numbers above depend on: the scorecard and the storey table
 * sit outside the tabs entirely, so whichever one is open, the reading of the
 * design is on screen.
 */
type RailTab = 'basics' | 'advanced' | 'saved' | 'critique'

const RAIL_TABS: ReadonlyArray<{ id: RailTab; label: string }> = [
  { id: 'basics', label: 'Basics' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'saved', label: 'Saved' },
  { id: 'critique', label: 'Critique' },
]

/** The small pixel-face heading that labels a block of the panel. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 font-pixel text-[0.7rem] tracking-widest text-ink/45">
      {children}
    </h3>
  )
}

export default function App() {
  const [tab, setTab] = useState<RailTab>('basics')
  // Session state, deliberately not persisted: a panel that stayed hidden
  // across reloads would leave a student with no numbers and no memory of
  // having hidden them.
  const [panelOpen, setPanelOpen] = useState(true)
  const { view, openStudio, openLanding } = useAppView()
  // Already settled: main.tsx consumed the link before the first render.
  const shared = sharedDesignOutcome()
  const structure = useDesignStore((state) => state.structure)
  const hazard = useDesignStore((state) => state.hazard)
  const selectedStoreyIndex = useDesignStore((state) => state.selectedStoreyIndex)
  const selectStorey = useDesignStore((state) => state.selectStorey)
  const pinBaseline = useDesignStore((state) => state.pinBaseline)
  const resetBaseline = useDesignStore((state) => state.resetBaseline)
  const startTutorial = useTutorialStore((state) => state.start)
  // `stepAt` hands back the same object from the module's own array, so this
  // selector is referentially stable and does not re-render on every store
  // touch the way a freshly built object would.
  const tutorialStep = useTutorialStore((state) =>
    state.stepIndex === null ? null : stepAt(state.stepIndex),
  )
  const { result, error } = useAnalysis()

  // A tour step can only ring a control that is rendered, and half of them
  // live under Basics. Without this, somebody who hits "Show me around" from
  // the Critique tab is walked through three steps pointing at nothing.
  //
  // An override derived during render, not a write into `tab`. Two things
  // follow, and both are better than the effect this replaces: there is no
  // extra render to show the right tab, and closing the tour puts the student
  // back on the tab *they* had open rather than wherever Bo finished. The tour
  // borrows the panel; it does not get to keep it.
  const activeTab: RailTab = tutorialStep?.tab ?? tab
  const { comparison, baselineLabel, isBaseline } = useComparison(result, structure)

  // After every hook, never inside a branch: the studio's hooks keep running
  // whichever page is showing, so switching views cannot reorder them.
  if (view === 'landing') return <Landing onOpenStudio={openStudio} />

  return (
    <div className="flex h-screen flex-col bg-paper font-body text-ink">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-ink/12 px-5 py-3">
        <button
          type="button"
          onClick={openLanding}
          className="font-display text-lg tracking-tight hover:text-coral"
        >
          Ballast
        </button>
        {/* Names the clause family the analysis on screen actually came from,
            which changes with the hazard — Chapter 5 is flood, 11-12 is
            seismic, 26-27 is wind. */}
        <p className="font-pixel text-[0.7rem] tracking-widest text-ink/45">
          {HAZARD_LABEL[hazard.kind].toUpperCase()} ·{' '}
          {HAZARD_PROVENANCE[hazard.kind]} · EVERY NUMBER FROM THE ENGINE
        </p>

        {shared.loadedName !== null && (
          <p className="max-w-xs truncate rounded-full border-2 border-bloom bg-bloom/15 px-3 py-0.5 text-xs">
            Opened “{shared.loadedName}” from a link
          </p>
        )}
        {shared.error !== null && (
          <p
            className="max-w-xs truncate rounded-full border-2 border-fail-ink/40 bg-fail/10 px-3 py-0.5 text-xs text-fail-ink"
            title={shared.error}
          >
            That link could not be opened: {shared.error}
          </p>
        )}

        <button
          type="button"
          onClick={startTutorial}
          title="Bo will show you around"
          className="ml-auto flex items-center gap-1.5 rounded-full border-2 border-ink bg-white py-1 pl-1.5 pr-3 font-display text-xs shadow-[3px_3px_0_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
        >
          <Bo mood="wave" size={18} />
          Show me around
        </button>

        <button
          type="button"
          onClick={() => setPanelOpen((open) => !open)}
          aria-expanded={panelOpen}
          aria-controls="studio-panel"
          className="rounded-full border-2 border-ink bg-white px-3 py-1 font-display text-xs shadow-[3px_3px_0_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
        >
          <span aria-hidden="true" className="mr-1.5 inline-block">
            {panelOpen ? '›' : '‹'}
          </span>
          {panelOpen ? 'Hide panel' : 'Show panel'}
        </button>
      </header>

      {error !== null || result === null ? (
        <main className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-md sticker p-5">
            <h2 className="font-display text-lg text-fail-ink">
              The engine rejected this design
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink/75">
              {error ?? 'Unknown error.'}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink/50">
              The controls are meant to make this unreachable, so this is a bug
              worth reporting rather than a state to design around.
            </p>
          </div>
        </main>
      ) : (
        <main
          className={`grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] transition-[grid-template-columns] duration-300 ease-out lg:grid-rows-1 ${
            panelOpen
              ? 'lg:grid-cols-[minmax(0,1fr)_24rem]'
              : 'lg:grid-cols-[minmax(0,1fr)_0rem]'
          }`}
        >
          <div className="min-h-0">
            <Viewport result={result} structure={structure} hazard={hazard} />
          </div>

          {/* Folded, the column goes to zero width and the panel is clipped
              rather than unmounted — it keeps its tab, its scroll position and
              any critique already fetched. `inert` takes it out of the tab
              order and off the accessibility tree while it is not visible,
              which clipping alone would not do. The inner column holds its
              full width throughout, so the contents slide out of view instead
              of reflowing on the way. */}
          <aside
            id="studio-panel"
            inert={!panelOpen}
            className={`min-h-0 overflow-hidden ${panelOpen ? '' : 'max-lg:hidden'}`}
          >
            <div className="flex h-full flex-col border-ink/12 max-lg:border-t-2 lg:w-96 lg:border-l-2">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                <div data-tour="score">
                <ScorePanel
                  result={result}
                  structure={structure}
                  comparison={comparison}
                  baselineLabel={baselineLabel}
                  isBaseline={isBaseline}
                  onPinBaseline={pinBaseline}
                  onResetBaseline={resetBaseline}
                />
                </div>

                <section data-tour="storeys">
                  <Eyebrow>PER STOREY</Eyebrow>
                  <StoreyTable
                    result={result}
                    selectedStoreyIndex={selectedStoreyIndex}
                    onSelect={selectStorey}
                  />
                </section>

                {/* The scorecard and the storey table stay put above this:
                    they are the numbers, and they should never be a tab away.
                    Only the things you act on -- controls, critique -- share
                    space. */}
                <nav
                  data-tour="tabs"
                  className="flex gap-0.5 rounded-full border-2 border-ink/12 bg-white p-1"
                >
                  {RAIL_TABS.map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTab(id)}
                      className={`flex-1 rounded-full px-1.5 py-1.5 font-display text-[0.7rem] transition-colors ${
                        activeTab === id
                          ? 'bg-ink text-paper'
                          : 'text-ink/55 hover:bg-ink/5 hover:text-ink'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </nav>

                {/* Above the controls, not behind a tab of its own: it is the
                    fastest way to get a building on screen, and what it writes
                    is exactly what the controls under it edit. */}
                {activeTab === 'basics' && (
                  <>
                    <BlueprintPanel />
                    <BasicControls />
                  </>
                )}
                {activeTab === 'advanced' && <AdvancedControls />}
                {activeTab === 'saved' && (
                  <SavedDesigns structure={structure} hazard={hazard} />
                )}
                {activeTab === 'critique' && (
                  <CritiquePanel
                    result={result}
                    structure={structure}
                    hazard={hazard}
                  />
                )}
              </div>
            </div>
          </aside>
        </main>
      )}

      {/* Last in the tree and fixed-positioned, so it sits over the studio
          without being inside either pane's overflow. */}
      <TutorialTour />
    </div>
  )
}
