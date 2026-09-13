/**
 * Save, reopen and share a design.
 *
 * Everything here goes through `DesignLibrary`, which is currently backed by
 * localStorage and will later be backed by Supabase. The component never
 * learns which — it awaits four methods — so signing in changes where designs
 * live without changing this file.
 *
 * Sharing needs no backend at all: the design travels inside the link. That is
 * deliberate. A classroom can pass designs around on day one, and it keeps
 * working during the demo if the network does not.
 */

import { useCallback, useEffect, useState } from 'react'
import type { Hazard, Structure } from '@/engine'
import { HAZARD_LABEL, hazardSummary } from '@/lib/hazard.ts'
import {
  createSavedDesign,
  newDesignId,
  type SavedDesign,
  MAX_NAME_LENGTH,
  shareUrl,
  type DesignRecord,
} from '@/persistence'
import { useDesignStore } from '@/store/design.ts'
import { useDesignLibrary } from '@/store/useDesignLibrary.ts'

export interface SavedDesignsProps {
  structure: Structure
  hazard: Hazard
}

function describe(record: DesignRecord): string {
  const storeys = record.design.structure.storeys.length
  const event = `${HAZARD_LABEL[record.design.hazard.kind]}, ${hazardSummary(record.design.hazard)}`
  const saved = new Date(record.design.savedAt)
  return `${storeys} storeys · ${event} · ${saved.toLocaleDateString()}`
}

export function SavedDesigns({ structure, hazard }: SavedDesignsProps) {
  const loadDesign = useDesignStore((state) => state.loadDesign)
  const [name, setName] = useState('')
  const [records, setRecords] = useState<DesignRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Account, browser, or nowhere -- decided in one place, and this component
  // deliberately cannot tell which it got.
  const { library, backend, notice: backendNotice } = useDesignLibrary()

  const refresh = useCallback(() => {
    if (library === null) return
    void library
      .list()
      .then(setRecords)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      )
  }, [library])

  useEffect(refresh, [refresh])

  const save = useCallback(() => {
    if (library === null) return
    setError(null)
    setNotice(null)
    try {
      const design = createSavedDesign(name, structure, hazard, new Date())
      void library
        .put({ id: newDesignId(), design })
        .then(() => {
          setName('')
          setNotice(`Saved "${design.name}".`)
          refresh()
        })
        .catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : String(cause)),
        )
    } catch (cause) {
      // createSavedDesign rejects a blank or overlong name synchronously.
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [library, name, structure, hazard, refresh])

  const copyLink = useCallback((design: SavedDesign) => {
    setError(null)
    const url = shareUrl(design, window.location.href)
    void navigator.clipboard
      .writeText(url)
      .then(() => setNotice(`Link to "${design.name}" copied.`))
      // Clipboard access needs a secure context and can be denied outright.
      // Falling back to putting the URL on screen beats a button that silently
      // does nothing.
      .catch(() => setNotice(url))
  }, [])

  /**
   * Sharing what is on screen right now, without saving it first. This is the
   * common move — a student has a design working and wants to send it — and
   * requiring a name and a save first would be ceremony in the way of it.
   */
  const copyCurrentLink = useCallback(() => {
    const label = name.trim().length > 0 ? name : 'Shared design'
    copyLink(createSavedDesign(label, structure, hazard, new Date()))
  }, [copyLink, name, structure, hazard])

  const remove = useCallback(
    (record: DesignRecord) => {
      if (library === null) return
      void library.remove(record.id).then(refresh)
    },
    [library, refresh],
  )

  if (backend === 'connecting') {
    return (
      <p className="text-[0.7rem] leading-relaxed text-neutral-500">
        Connecting to your saved designs…
      </p>
    )
  }

  if (library === null) {
    return (
      <p className="slab border-caution-ink/30 bg-caution/10 px-2.5 py-2 text-[0.7rem] leading-relaxed text-caution-ink">
        This browser is not allowing site storage, so designs cannot be saved
        here. Share links still work — they carry the design inside the URL.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <input
          type="text"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          placeholder="Name this design"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save()
          }}
          className="min-w-0 flex-1 rounded-lg border-2 border-ink/15 bg-white px-2.5 py-1.5 text-xs text-ink placeholder:text-ink/35 focus:border-ink focus:outline-none"
        />
        <button
          type="button"
          onClick={save}
          disabled={name.trim().length === 0}
          className="rounded-full border-2 border-ink bg-mint px-4 py-1.5 font-display text-xs text-ink shadow-[3px_3px_0_0_var(--color-ink)] transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-45"
        >
          Save
        </button>
      </div>

      <button
        type="button"
        onClick={copyCurrentLink}
        className="w-full rounded-full border-2 border-ink/15 bg-white py-1.5 font-display text-[0.7rem] text-ink/65 hover:border-ink hover:text-ink"
      >
        Copy a link to the design on screen
      </button>

      {error !== null && (
        <p className="slab border-fail-ink/30 bg-fail/10 px-2.5 py-2 text-[0.7rem] leading-relaxed text-ink/75">
          <span className="font-display text-fail-ink">Could not save. </span>
          {error}
        </p>
      )}

      {backendNotice !== null && (
        <p className="slab border-caution-ink/30 bg-caution/10 px-2.5 py-2 text-[0.7rem] leading-relaxed text-ink/75">
          {backendNotice}
        </p>
      )}

      {notice !== null && (
        <p className="slab break-all px-2.5 py-2 text-[0.7rem] leading-relaxed text-ink/70">
          {notice}
        </p>
      )}

      {records.length === 0 ? (
        <p className="text-[0.7rem] leading-relaxed text-ink/55">
          {backend === 'cloud'
            ? 'Nothing saved yet. Designs are kept against this browser\u2019s anonymous account, so they survive a reload. A share link carries one to anybody.'
            : 'Nothing saved yet. Designs are kept in this browser; a share link carries one to anybody, no account needed.'}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {records.map((record) => (
            <li
              key={record.id}
              className="slab p-2.5"
            >
              <p className="truncate font-display text-sm text-ink">
                {record.design.name}
              </p>
              <p className="mt-0.5 text-[0.65rem] text-ink/50">
                {describe(record)}
              </p>
              <div className="mt-1.5 flex gap-1">
                <button
                  type="button"
                  onClick={() => loadDesign(record.design)}
                  className="rounded-full border-2 border-ink/20 bg-white px-2.5 py-1 font-display text-[0.65rem] text-ink hover:border-ink"
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => copyLink(record.design)}
                  className="rounded-full border-2 border-ink/20 bg-white px-2.5 py-1 font-display text-[0.65rem] text-ink hover:border-ink"
                >
                  Copy link
                </button>
                <button
                  type="button"
                  onClick={() => remove(record)}
                  className="ml-auto rounded-full px-2 py-1 font-display text-[0.65rem] text-ink/45 hover:text-fail-ink"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
