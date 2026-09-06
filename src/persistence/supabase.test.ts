/**
 * Tested against a fake client rather than a live project, the same way
 * `library.test.ts` fakes `Storage` — so the suite stays offline and a test can
 * make the database misbehave on demand, which a real one will not do when
 * asked.
 *
 * The cases that matter are the ones where a *row* is wrong rather than the
 * request: a row written by an older schema, or one with a material this build
 * has never heard of. Those are the reason rows go back through `parseDesign`
 * instead of being cast into shape.
 */

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MATERIAL_LIBRARY } from '@/engine'
import { DEFAULT_HAZARD, DEFAULT_STRUCTURE } from '@/store/design.ts'
import { DesignStorageError } from './library.ts'
import { createSavedDesign, DESIGN_SCHEMA_VERSION } from './schema.ts'
import { createSupabaseDesignLibrary, DESIGNS_TABLE } from './supabase.ts'

interface Row {
  id: string
  name: string
  saved_at: string
  schema_version: number
  structure: unknown
  hazard: unknown
}

const SAVED_AT = new Date('2026-03-01T12:00:00.000Z')

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Baseline CLT',
    // Postgres hands back an offset, not the Z that toISOString() writes.
    saved_at: '2026-03-01T12:00:00+00:00',
    schema_version: DESIGN_SCHEMA_VERSION,
    structure: JSON.parse(JSON.stringify(DEFAULT_STRUCTURE)) as unknown,
    hazard: JSON.parse(JSON.stringify(DEFAULT_HAZARD)) as unknown,
    ...overrides,
  }
}

interface FakeState {
  rows: Row[]
  error: { message: string; code?: string } | null
}

/** Records what the adapter asked for, so the tests can assert on the query. */
interface Calls {
  table: string[]
  order: Array<{ column: string; ascending: boolean }>
  eq: Array<{ column: string; value: string }>
  upserted: Row[]
  deleted: boolean
}

function fakeClient(state: FakeState) {
  const calls: Calls = { table: [], order: [], eq: [], upserted: [], deleted: false }

  const client = {
    from(table: string) {
      calls.table.push(table)
      return {
        select() {
          return {
            order(column: string, options: { ascending: boolean }) {
              calls.order.push({ column, ascending: options.ascending })
              return Promise.resolve({ data: state.rows, error: state.error })
            },
            eq(column: string, value: string) {
              calls.eq.push({ column, value })
              return {
                maybeSingle: () =>
                  Promise.resolve({
                    data: state.rows.find((r) => r.id === value) ?? null,
                    error: state.error,
                  }),
              }
            },
          }
        },
        upsert(record: Row) {
          calls.upserted.push(record)
          return Promise.resolve({ error: state.error })
        },
        delete() {
          calls.deleted = true
          return {
            eq(column: string, value: string) {
              calls.eq.push({ column, value })
              return Promise.resolve({ error: state.error })
            },
          }
        },
      }
    },
  }

  return {
    calls,
    library: createSupabaseDesignLibrary(
      client as unknown as SupabaseClient,
      MATERIAL_LIBRARY,
    ),
  }
}

describe('reading', () => {
  it('turns a row into a validated design', async () => {
    const { library } = fakeClient({ rows: [row()], error: null })
    const listed = await library.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.design.name).toBe('Baseline CLT')
    expect(listed[0]?.design.structure.storeys).toHaveLength(6)
  })

  it('asks the database to do the ordering', async () => {
    const { calls, library } = fakeClient({ rows: [], error: null })
    await library.list()
    expect(calls.table).toEqual([DESIGNS_TABLE])
    expect(calls.order).toEqual([{ column: 'saved_at', ascending: false }])
  })

  it('accepts the offset timestamp Postgres actually returns', async () => {
    const { library } = fakeClient({ rows: [row()], error: null })
    const listed = await library.list()
    expect(Date.parse(listed[0]?.design.savedAt ?? '')).toBe(SAVED_AT.getTime())
  })

  it('skips a row from a schema version it cannot read, keeping the rest', async () => {
    const { library } = fakeClient({
      rows: [row({ id: 'a', schema_version: 99 }), row({ id: 'b' })],
      error: null,
    })
    expect((await library.list()).map((r) => r.id)).toEqual(['b'])
  })

  it('skips a row naming a material this build does not have', async () => {
    const structure = JSON.parse(JSON.stringify(DEFAULT_STRUCTURE)) as {
      storeys: Array<{ materialId: string }>
    }
    structure.storeys[0]!.materialId = 'unobtainium'
    const { library } = fakeClient({
      rows: [row({ id: 'a', structure }), row({ id: 'b' })],
      error: null,
    })
    expect((await library.list()).map((r) => r.id)).toEqual(['b'])
  })

  it('migrates a row written by an older version of the app', async () => {
    const structure = JSON.parse(JSON.stringify(DEFAULT_STRUCTURE)) as {
      storeys: Array<Record<string, unknown>>
    }
    for (const storey of structure.storeys) delete storey['facade']

    const { library } = fakeClient({
      rows: [row({ schema_version: 1, structure })],
      error: null,
    })
    const listed = await library.list()
    expect(listed).toHaveLength(1)
    // Migrated on the way in, so what the app holds is a current design
    // whatever version it arrived as.
    expect(listed[0]?.design.schemaVersion).toBe(DESIGN_SCHEMA_VERSION)
    expect(listed[0]?.design.structure.storeys[0]?.facade).toBeDefined()
  })

  it('returns null for an id that is not there', async () => {
    const { library } = fakeClient({ rows: [], error: null })
    expect(await library.get('missing')).toBeNull()
  })

  it('returns null rather than throwing for a row it cannot parse', async () => {
    const { library } = fakeClient({ rows: [row({ id: 'x', name: '' })], error: null })
    expect(await library.get('x')).toBeNull()
  })
})

describe('writing', () => {
  it('sends the columns the table expects', async () => {
    const { calls, library } = fakeClient({ rows: [], error: null })
    const design = createSavedDesign('Tower A', DEFAULT_STRUCTURE, DEFAULT_HAZARD, SAVED_AT)
    await library.put({ id: 'abc', design })

    expect(calls.upserted).toHaveLength(1)
    expect(calls.upserted[0]).toMatchObject({
      id: 'abc',
      name: 'Tower A',
      saved_at: '2026-03-01T12:00:00.000Z',
      schema_version: DESIGN_SCHEMA_VERSION,
    })
  })

  it('never sends user_id — Postgres decides ownership from the session', async () => {
    const { calls, library } = fakeClient({ rows: [], error: null })
    const design = createSavedDesign('Tower A', DEFAULT_STRUCTURE, DEFAULT_HAZARD, SAVED_AT)
    await library.put({ id: 'abc', design })
    expect(calls.upserted[0]).not.toHaveProperty('user_id')
  })

  it('deletes by id', async () => {
    const { calls, library } = fakeClient({ rows: [], error: null })
    await library.remove('abc')
    expect(calls.deleted).toBe(true)
    expect(calls.eq).toEqual([{ column: 'id', value: 'abc' }])
  })
})

describe('database errors', () => {
  const failure = { message: 'permission denied', code: '42501' }

  it('reports a failed read, with the Postgres code', async () => {
    const { library } = fakeClient({ rows: [], error: failure })
    await expect(library.list()).rejects.toThrow(DesignStorageError)
    await expect(library.list()).rejects.toThrow(/permission denied \(42501\)/)
  })

  it('names the design in a failed save', async () => {
    const { library } = fakeClient({ rows: [], error: failure })
    const design = createSavedDesign('Tower A', DEFAULT_STRUCTURE, DEFAULT_HAZARD, SAVED_AT)
    await expect(library.put({ id: 'abc', design })).rejects.toThrow(/save "Tower A"/)
  })

  it('reports a failed delete', async () => {
    const { library } = fakeClient({ rows: [], error: failure })
    await expect(library.remove('abc')).rejects.toThrow(DesignStorageError)
  })
})
