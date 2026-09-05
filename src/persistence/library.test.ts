/**
 * The local library is tested against a fake `Storage` rather than jsdom, so
 * the suite stays in the node environment and a test can make storage
 * misbehave — throw on read, throw on write, hold a corrupt value — which is
 * the interesting half of the behaviour and the half a real localStorage will
 * not do on demand.
 */

import { describe, expect, it } from 'vitest'
import { MATERIAL_LIBRARY } from '@/engine'
import { DEFAULT_HAZARD, DEFAULT_STRUCTURE } from '@/store/design.ts'
import { createSavedDesign, serializeDesign, type SavedDesign } from './schema.ts'
import {
  browserStorage,
  createLocalDesignLibrary,
  DesignStorageError,
  newDesignId,
  STORAGE_PREFIX,
  type DesignRecord,
} from './library.ts'

class FakeStorage implements Storage {
  readonly map = new Map<string, string>()
  failOnRead = false
  failOnWrite = false

  get length(): number {
    if (this.failOnRead) throw new Error('storage unavailable')
    return this.map.size
  }
  key(index: number): string | null {
    if (this.failOnRead) throw new Error('storage unavailable')
    return [...this.map.keys()][index] ?? null
  }
  getItem(key: string): string | null {
    if (this.failOnRead) throw new Error('storage unavailable')
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    if (this.failOnWrite) throw new Error('QuotaExceededError')
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  clear(): void {
    this.map.clear()
  }
}

function setup() {
  const storage = new FakeStorage()
  const library = createLocalDesignLibrary({ storage, materials: MATERIAL_LIBRARY })
  return { storage, library }
}

function record(name: string, savedAt: string, id = newDesignId()): DesignRecord {
  return {
    id,
    design: createSavedDesign(name, DEFAULT_STRUCTURE, DEFAULT_HAZARD, new Date(savedAt)),
  }
}

describe('put / get / remove', () => {
  it('round-trips a design', async () => {
    const { library } = setup()
    const saved = record('Tower A', '2026-03-01T10:00:00.000Z')
    await library.put(saved)
    expect(await library.get(saved.id)).toEqual(saved)
  })

  it('returns null for an id it does not have', async () => {
    const { library } = setup()
    expect(await library.get('nope')).toBeNull()
  })

  it('replaces on a second put with the same id', async () => {
    const { library } = setup()
    const first = record('Draft', '2026-03-01T10:00:00.000Z')
    await library.put(first)
    await library.put({ id: first.id, design: { ...first.design, name: 'Final' } })
    expect((await library.get(first.id))?.design.name).toBe('Final')
    expect(await library.list()).toHaveLength(1)
  })

  it('removes', async () => {
    const { library } = setup()
    const saved = record('Tower A', '2026-03-01T10:00:00.000Z')
    await library.put(saved)
    await library.remove(saved.id)
    expect(await library.get(saved.id)).toBeNull()
  })

  it('removing something absent is not an error', async () => {
    const { library } = setup()
    await expect(library.remove('nope')).resolves.toBeUndefined()
  })
})

describe('list', () => {
  it('is newest first', async () => {
    const { library } = setup()
    await library.put(record('Oldest', '2026-01-01T00:00:00.000Z'))
    await library.put(record('Newest', '2026-06-01T00:00:00.000Z'))
    await library.put(record('Middle', '2026-03-01T00:00:00.000Z'))
    expect((await library.list()).map((r) => r.design.name))
      .toEqual(['Newest', 'Middle', 'Oldest'])
  })

  it('is empty on a fresh storage', async () => {
    const { library } = setup()
    expect(await library.list()).toEqual([])
  })

  it('ignores keys belonging to other apps', async () => {
    const { storage, library } = setup()
    storage.map.set('some-other-app.state', '{"not":"ours"}')
    await library.put(record('Ours', '2026-03-01T00:00:00.000Z'))
    expect(await library.list()).toHaveLength(1)
  })
})

describe('damaged storage', () => {
  it('skips one corrupt record and keeps the rest', async () => {
    const { storage, library } = setup()
    await library.put(record('Good', '2026-03-01T00:00:00.000Z'))
    storage.map.set(`${STORAGE_PREFIX}broken`, '{ truncated')
    const listed = await library.list()
    expect(listed.map((r) => r.design.name)).toEqual(['Good'])
  })

  it('skips a record from a schema version it cannot read', async () => {
    const { storage, library } = setup()
    const future: SavedDesign = { ...record('Future', '2026-03-01T00:00:00.000Z').design, schemaVersion: 99 }
    storage.map.set(`${STORAGE_PREFIX}future`, serializeDesign(future))
    await library.put(record('Readable', '2026-02-01T00:00:00.000Z'))
    expect((await library.list()).map((r) => r.design.name)).toEqual(['Readable'])
  })

  it('leaves an unreadable record in place rather than deleting the work', async () => {
    const { storage, library } = setup()
    storage.map.set(`${STORAGE_PREFIX}broken`, '{ truncated')
    await library.list()
    expect(storage.map.has(`${STORAGE_PREFIX}broken`)).toBe(true)
  })

  it('reports an empty library when storage cannot be read at all', async () => {
    const { storage, library } = setup()
    await library.put(record('Tower A', '2026-03-01T00:00:00.000Z'))
    storage.failOnRead = true
    expect(await library.list()).toEqual([])
    expect(await library.get('anything')).toBeNull()
  })

  it('raises on a write it could not perform, rather than losing it quietly', async () => {
    const { storage, library } = setup()
    storage.failOnWrite = true
    await expect(library.put(record('Tower A', '2026-03-01T00:00:00.000Z')))
      .rejects.toThrow(DesignStorageError)
    await expect(library.put(record('Tower A', '2026-03-01T00:00:00.000Z')))
      .rejects.toThrow(/storage may be full or disabled/)
  })
})

describe('browserStorage', () => {
  function withLocalStorage(define: PropertyDescriptor, run: () => void) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...define })
    try {
      run()
    } finally {
      if (original === undefined) delete (globalThis as { localStorage?: unknown }).localStorage
      else Object.defineProperty(globalThis, 'localStorage', original)
    }
  }

  it('returns null when reading the property itself throws', () => {
    // Safari private mode and blocked site data both fail here, not on the
    // first getItem, which is why browserStorage cannot be a ?? expression.
    withLocalStorage(
      { get() { throw new Error('The operation is insecure.') } },
      () => { expect(browserStorage()).toBeNull() },
    )
  })

  it('returns null where there is no localStorage at all', () => {
    withLocalStorage({ value: undefined }, () => {
      expect(browserStorage()).toBeNull()
    })
  })

  it('returns the storage when the browser provides one', () => {
    const fake = new FakeStorage()
    withLocalStorage({ value: fake }, () => {
      expect(browserStorage()).toBe(fake)
    })
  })
})
