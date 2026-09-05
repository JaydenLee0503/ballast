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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MATERIAL_LIBRARY, type Structure, type WindHazard } from '@/engine'
import {
  browserStorage,
  createLocalDesignLibrary,
  createSavedDesign,
  newDesignId,
  type SavedDesign,
  MAX_NAME_LENGTH,
  shareUrl,
  type DesignRecord,
} from '@/persistence'
import { useDesignStore } from '@/store/design.ts'

export interface SavedDesignsProps {
  structure: Structure
  hazard: WindHazard
}

function describe(record: DesignRecord): string {
  const storeys = record.design.structure.storeys.length
  const gust = Math.round(record.design.hazard.gustSpeed_kmh)
  const saved = new Date(record.design.savedAt)
  return `${storeys} storeys · ${gust} km/h · ${saved.toLocaleDateString()}`
}

export function SavedDesigns({ structure, hazard }: SavedDesignsProps) {
  const loadDesign = useDesignStore((state) => state.loadDesign)
  const [name, setName] = useState('')
  const [records, setRecords] = useState<DesignRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // One storage handle for the life of the component; `browserStorage()`
  // returns null where site data is blocked, which is a state to report rather
  // than a crash to hit on the first save.
  const storage = useMemo(() => browserStorage(), [])
  const library = useMemo(
    () =>
      storage === null
        ? null
        : createLocalDesignLibrary({ storage, materials: MATERIAL_LIBRARY }),
    [storage],
  )

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

  if (library === null) {
    return (
      <p className="rounded border border-caution/40 px-2 py-1.5 text-[0.7rem] leading-relaxed text-caution">
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
          className="min-w-0 flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-600"
        />
        <button
          type="button"
          onClick={save}
          disabled={name.trim().length === 0}
          className="rounded border border-wind/60 bg-wind/10 px-3 py-1.5 text-xs text-neutral-100 hover:bg-wind/20 disabled:opacity-40"
        >
          Save
        </button>
      </div>

      <button
        type="button"
        onClick={copyCurrentLink}
        className="w-full rounded border border-neutral-800 py-1.5 text-[0.7rem] text-neutral-400 hover:bg-neutral-900"
      >
        Copy a link to the design on screen
      </button>

      {error !== null && (
        <p className="rounded border border-fail/50 px-2 py-1.5 text-[0.7rem] leading-relaxed text-neutral-300">
          <span className="font-medium text-fail">Could not save. </span>
          {error}
        </p>
      )}

      {notice !== null && (
        <p className="break-all rounded border border-neutral-800 px-2 py-1.5 text-[0.7rem] leading-relaxed text-neutral-400">
          {notice}
        </p>
      )}

      {records.length === 0 ? (
        <p className="text-[0.7rem] leading-relaxed text-neutral-500">
          Nothing saved yet. Designs are kept in this browser; a share link
          carries one to anybody, no account needed.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {records.map((record) => (
            <li
              key={record.id}
              className="rounded border border-neutral-800 bg-neutral-900/40 p-2"
            >
              <p className="truncate text-xs font-medium text-neutral-200">
                {record.design.name}
              </p>
              <p className="mt-0.5 text-[0.65rem] text-neutral-600">
                {describe(record)}
              </p>
              <div className="mt-1.5 flex gap-1">
                <button
                  type="button"
                  onClick={() => loadDesign(record.design)}
                  className="rounded border border-neutral-700 px-2 py-1 text-[0.65rem] text-neutral-300 hover:bg-neutral-800"
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => copyLink(record.design)}
                  className="rounded border border-neutral-700 px-2 py-1 text-[0.65rem] text-neutral-300 hover:bg-neutral-800"
                >
                  Copy link
                </button>
                <button
                  type="button"
                  onClick={() => remove(record)}
                  className="ml-auto rounded px-2 py-1 text-[0.65rem] text-neutral-600 hover:text-fail"
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
