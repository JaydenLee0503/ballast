/**
 * Where saved designs live.
 *
 * `DesignLibrary` is the interface; `createLocalDesignLibrary` is the
 * implementation that keeps them in the browser's localStorage. Supabase will
 * be a second implementation of the same four methods, so the components that
 * save and load never learn which one they are talking to.
 *
 * The methods are async even though localStorage is not. A synchronous
 * interface would be honest about this implementation and wrong about the next
 * one, and the cost of discovering that later is every call site changing at
 * the moment a network is introduced. One `await` now is cheaper.
 *
 * Storage layout: one key per design, `resilience-studio.design.<id>`, rather
 * than a single key holding an array. It costs a key scan on `list()` and buys
 * two things — a save rewrites one entry instead of all of them, and a single
 * corrupt or unreadable record loses one design rather than the whole library.
 */

import type { MaterialLibrary } from '@/engine'
import { parseDesignJson, serializeDesign, type SavedDesign } from './schema.ts'

export const STORAGE_PREFIX = 'resilience-studio.design.'

export interface DesignRecord {
  id: string
  design: SavedDesign
}

export interface DesignLibrary {
  /** Newest first, by `savedAt`. Unreadable records are skipped, not thrown. */
  list(): Promise<DesignRecord[]>
  get(id: string): Promise<DesignRecord | null>
  /** Insert or replace. The caller owns the id, so both backends can upsert. */
  put(record: DesignRecord): Promise<void>
  remove(id: string): Promise<void>
}

/** Raised for storage failures, as distinct from a design that will not parse. */
export class DesignStorageError extends Error {
  override readonly name = 'DesignStorageError'
}

export interface LocalDesignLibraryOptions {
  storage: Storage
  materials: MaterialLibrary
}

/**
 * Ids are minted by the caller, not the library, so the same `DesignRecord`
 * can be handed to a local store and a remote one and mean the same design.
 */
export function newDesignId(): string {
  return crypto.randomUUID()
}

/**
 * `localStorage` where it is available, null where it is not.
 *
 * Reading the property itself — not just calling a method on it — throws in
 * Safari's private mode and wherever site data is blocked, so this cannot be
 * `globalThis.localStorage ?? null`. Callers get null and can say "saving is
 * unavailable in this browser" instead of showing a save button that fails.
 */
export function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage as Storage | undefined ?? null
  } catch {
    return null
  }
}

/**
 * Every storage access goes through this. Reading localStorage throws outright
 * in Safari's private mode and wherever site data is blocked, and a student
 * whose browser refuses to store things should still be able to use the
 * simulator — so a read that fails yields nothing rather than an exception.
 * Writes are the exception to the exception: silently failing to save is worse
 * than an error message, so `put` lets its failure through.
 */
function readQuietly<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}

export function createLocalDesignLibrary(
  options: LocalDesignLibraryOptions,
): DesignLibrary {
  const { storage, materials } = options
  const keyFor = (id: string): string => `${STORAGE_PREFIX}${id}`

  function readRecord(key: string): DesignRecord | null {
    const json = readQuietly(() => storage.getItem(key), null)
    if (json === null) return null
    try {
      return { id: key.slice(STORAGE_PREFIX.length), design: parseDesignJson(json, materials) }
    } catch {
      // A design written by an older schema, or a corrupted entry. Skipping it
      // keeps the rest of the list usable; `list()` is not the place to explain
      // why, and deleting it here would destroy work a later version could read.
      return null
    }
  }

  // Every method is `async`, not merely Promise-returning. The difference
  // matters on the failure path: a synchronous `throw` out of a function typed
  // `Promise<void>` escapes a caller's `.catch()` entirely. Declaring them
  // async makes "errors arrive as rejections" true by construction rather than
  // by remembering.
  return {
    list: async () =>
      readQuietly(() => {
        const keys: string[] = []
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i)
          if (key !== null && key.startsWith(STORAGE_PREFIX)) keys.push(key)
        }
        return keys
      }, [])
        .map(readRecord)
        .filter((record): record is DesignRecord => record !== null)
        // ISO-8601 UTC from toISOString() is fixed-width, so a string compare
        // orders it correctly without parsing every date.
        .sort((a, b) => b.design.savedAt.localeCompare(a.design.savedAt)),

    get: async (id) => readRecord(keyFor(id)),

    put: async (record) => {
      try {
        storage.setItem(keyFor(record.id), serializeDesign(record.design))
      } catch (error) {
        throw new DesignStorageError(
          `could not save "${record.design.name}": ${
            error instanceof Error ? error.message : String(error)
          }. Browser storage may be full or disabled.`,
        )
      }
    },

    remove: async (id) => {
      readQuietly(() => storage.removeItem(keyFor(id)), undefined)
    },
  }
}
