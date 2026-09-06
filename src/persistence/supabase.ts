/**
 * A `DesignLibrary` backed by Supabase.
 *
 * Same four methods as the localStorage one, so `SavedDesigns.tsx` cannot tell
 * which it is holding. That was the point of making the interface async before
 * there was a network behind it.
 *
 * **A row is untrusted input.** It may have been written by an older build of
 * the app, by another device, or by someone with the anon key and a REST
 * client. So rows go through `parseDesign` on the way out, exactly like a blob
 * from localStorage does — and for the same reason: the engine throws on a bad
 * structure, and the whole UI hangs off one analysis.
 *
 * `user_id` is deliberately never sent. The column defaults to `auth.uid()` in
 * Postgres, so ownership is decided by the session the request is made with and
 * cannot be forged by the client. Row Level Security then restricts every read
 * and write to rows matching that same id — which is the real security boundary
 * here, not the secrecy of the anon key.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MaterialLibrary } from '@/engine'
import { parseDesign, type SavedDesign } from './schema.ts'
import {
  DesignStorageError,
  type DesignLibrary,
  type DesignRecord,
} from './library.ts'

export const DESIGNS_TABLE = 'designs'

/** Named explicitly rather than `*`, so a new column cannot change the shape. */
const COLUMNS = 'id,name,saved_at,schema_version,structure,hazard'

interface DesignRow {
  id: string
  name: string
  saved_at: string
  schema_version: number
  structure: unknown
  hazard: unknown
}

interface PostgrestError {
  message: string
  code?: string
}

function storageError(action: string, error: PostgrestError): DesignStorageError {
  const code = error.code === undefined ? '' : ` (${error.code})`
  return new DesignStorageError(`could not ${action}: ${error.message}${code}`)
}

/**
 * Postgres returns a timestamptz as `+00:00` where the local library stores the
 * `Z` that `toISOString()` produces. Both parse, and `savedAt` is display and
 * ordering only — never an input to a calculation — so the difference is
 * allowed to show rather than being normalised away.
 */
function toRecord(row: DesignRow, materials: MaterialLibrary): DesignRecord {
  const design: SavedDesign = parseDesign(
    {
      schemaVersion: row.schema_version,
      name: row.name,
      savedAt: row.saved_at,
      structure: row.structure,
      hazard: row.hazard,
    },
    materials,
  )
  return { id: row.id, design }
}

export function createSupabaseDesignLibrary(
  client: SupabaseClient,
  materials: MaterialLibrary,
): DesignLibrary {
  const table = () => client.from(DESIGNS_TABLE)

  return {
    list: async () => {
      const { data, error } = await table()
        .select(COLUMNS)
        .order('saved_at', { ascending: false })
      if (error) throw storageError('load your designs', error)

      // One unreadable row loses one design, not the list. Same rule as the
      // local library, and the reason `parseDesign` rejects rather than repairs.
      return ((data ?? []) as DesignRow[]).flatMap((row) => {
        try {
          return [toRecord(row, materials)]
        } catch {
          return []
        }
      })
    },

    get: async (id) => {
      const { data, error } = await table().select(COLUMNS).eq('id', id).maybeSingle()
      if (error) throw storageError('open that design', error)
      if (data === null) return null
      try {
        return toRecord(data as DesignRow, materials)
      } catch {
        return null
      }
    },

    put: async (record) => {
      const { error } = await table().upsert({
        id: record.id,
        name: record.design.name,
        saved_at: record.design.savedAt,
        schema_version: record.design.schemaVersion,
        structure: record.design.structure,
        hazard: record.design.hazard,
      })
      if (error) throw storageError(`save "${record.design.name}"`, error)
    },

    remove: async (id) => {
      const { error } = await table().delete().eq('id', id)
      if (error) throw storageError('delete that design', error)
    },
  }
}
