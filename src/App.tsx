/**
 * Application shell: the model on the left, the numbers on the right.
 *
 * The two panes are the same data. Colours in the viewport and percentages in
 * the table both come from `StoreyResult.utilization`, so a student can move
 * between "which bit is red" and "why" without a translation step. This is
 * the only place `useAnalysis()` is called; everything below takes the result
 * as a prop, which keeps one analysis per render and makes it obvious that
 * nothing else is computing numbers of its own.
 */

import { DesignControls } from '@/components/DesignControls.tsx'
import { ScorePanel } from '@/components/ScorePanel.tsx'
import { StoreyTable } from '@/components/StoreyTable.tsx'
import { Viewport } from '@/components/Viewport.tsx'
import { useDesignStore } from '@/store/design.ts'
import { useAnalysis } from '@/store/useAnalysis.ts'

export default function App() {
  const structure = useDesignStore((state) => state.structure)
  const hazard = useDesignStore((state) => state.hazard)
  const selectedStoreyIndex = useDesignStore((state) => state.selectedStoreyIndex)
  const selectStorey = useDesignStore((state) => state.selectStorey)
  const { result, error } = useAnalysis()

  return (
    <div className="flex h-screen flex-col bg-neutral-950 font-sans text-neutral-100">
      <header className="flex items-baseline gap-3 border-b border-neutral-900 px-5 py-3">
        <h1 className="text-sm font-semibold tracking-tight">Resilience Studio</h1>
        <p className="text-xs text-neutral-500">
          Wind · ASCE 7-style · every number from the engine
        </p>
      </header>

      {error !== null || result === null ? (
        <main className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-md rounded-lg border border-fail/50 p-4 text-sm">
            <h2 className="font-medium text-fail">The engine rejected this design</h2>
            <p className="mt-2 text-neutral-400">{error ?? 'Unknown error.'}</p>
            <p className="mt-2 text-xs text-neutral-600">
              The controls are meant to make this unreachable, so this is a bug
              worth reporting rather than a state to design around.
            </p>
          </div>
        </main>
      ) : (
        <main className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-1">
          <div className="min-h-0">
            <Viewport result={result} structure={structure} hazard={hazard} />
          </div>

          <aside className="min-h-0 space-y-4 overflow-y-auto border-neutral-900 p-4 lg:border-l">
            <ScorePanel result={result} structure={structure} />

            <section className="border-t border-neutral-900 pt-4">
              <h3 className="mb-2 text-[0.65rem] uppercase tracking-wider text-neutral-600">
                Per storey
              </h3>
              <StoreyTable
                result={result}
                selectedStoreyIndex={selectedStoreyIndex}
                onSelect={selectStorey}
              />
            </section>

            <DesignControls />

            {result.warnings.length > 0 && (
              <section className="border-t border-neutral-900 pt-4">
                <h3 className="mb-2 text-[0.65rem] uppercase tracking-wider text-neutral-600">
                  Modelling caveats
                </h3>
                <ul className="space-y-2 text-[0.7rem] leading-relaxed text-caution/80">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </main>
      )}
    </div>
  )
}
