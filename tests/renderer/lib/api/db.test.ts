// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { fakeBridge } from '../../fakeBridge'
import {
  dbAdminMutationOptions,
  dbStatsQueryOptions,
  dbTableRowsQueryOptions,
  useDbAdminMutations
} from '@renderer/lib/api/db'
import { queryKeys } from '@renderer/lib/api/keys'
import { failureMessage } from '@renderer/lib/queryClient'

const ORPHANS = { dbOrphans: [], fileOrphans: [] }

function stubDb() {
  return {
    stats: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      dbFileSize: 0,
      walFileSize: 0,
      tables: []
    }),
    tableRows: vi.fn().mockResolvedValue({ rows: [], total: 0, columns: [] }),
    createRow: vi.fn().mockResolvedValue({}),
    updateRow: vi.fn().mockResolvedValue(true),
    deleteRow: vi.fn().mockResolvedValue(true),
    vacuum: vi.fn().mockResolvedValue({ freedBytes: 0 }),
    rebuildFts: vi.fn().mockResolvedValue({ rowsIndexed: 0, textsHealed: 0 }),
    purgeArchived: vi.fn().mockResolvedValue({ casesDeleted: 0, capturesDeleted: 0 }),
    findOrphans: vi.fn().mockResolvedValue(ORPHANS),
    cleanOrphans: vi.fn().mockResolvedValue({ dbRecordsRemoved: 0, filesRemoved: 0 }),
    backup: vi.fn().mockResolvedValue({ path: '/tmp/b.sqlite' }),
    restore: vi.fn().mockResolvedValue({ restored: true }),
    exportTable: vi.fn().mockResolvedValue({ path: '/tmp/cases.csv' })
  }
}

let db: ReturnType<typeof stubDb>

beforeEach(() => {
  db = stubDb()
  fakeBridge({ db })
})

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  return { client, wrapper }
}

describe('db query keys', () => {
  it('gives table rows a page-specific key under a shared prefix', () => {
    expect(queryKeys.dbStats).toEqual(['dbStats'])
    expect(queryKeys.dbTableRowsAll).toEqual(['dbTableRows'])
    expect(queryKeys.dbTableRows('cases', 50, 50)).toEqual(['dbTableRows', 'cases', 50, 50])
    // The prefix has to be a real prefix, or a write cannot invalidate every
    // page of the table it just changed.
    expect(queryKeys.dbTableRows('cases', 0, 50).slice(0, 1)).toEqual(queryKeys.dbTableRowsAll)
  })
})

describe('db query options', () => {
  // The bridge only exists on window in the renderer, and beforeEach installs
  // the stub long after this module was imported. A queryFn that captured
  // window.birdbrain at module scope would hold the pre-stub value and fail
  // here — which is the point of the assertion.
  it('resolves the bridge at call time, not at module load', async () => {
    await dbStatsQueryOptions.queryFn?.({} as never)
    expect(db.stats).toHaveBeenCalled()
  })

  it('wires each query option to the matching bridge method', async () => {
    expect(dbStatsQueryOptions.queryKey).toEqual(['dbStats'])

    const params = { table: 'captures', offset: 100, limit: 50 }
    const rows = dbTableRowsQueryOptions(params)
    expect(rows.queryKey).toEqual(['dbTableRows', 'captures', 100, 50])
    await rows.queryFn?.({} as never)
    expect(db.tableRows).toHaveBeenCalledWith(params)
  })

  it('holds the current page on screen while the next page of the same table loads', async () => {
    const { wrapper } = setup()
    const page0 = { rows: [{ id: 'a' }], total: 100, columns: [] }
    db.tableRows.mockResolvedValueOnce(page0)

    const { result, rerender } = renderHook(
      ({ offset }: { offset: number }) =>
        useQuery(dbTableRowsQueryOptions({ table: 'cases', offset, limit: 50 })),
      { wrapper, initialProps: { offset: 0 } }
    )
    await waitFor(() => expect(result.current.data).toEqual(page0))

    // Page 2 never resolves, so what the component can render is entirely the
    // placeholder. Without it the pager unmounts mid-click.
    db.tableRows.mockReturnValueOnce(new Promise(() => {}))
    rerender({ offset: 50 })

    expect(result.current.data).toEqual(page0)
    expect(result.current.isPending).toBe(false)
  })

  it('shows nothing from the previous table while a different table loads', async () => {
    const { wrapper } = setup()
    const casesPage = { rows: [{ id: 'a' }], total: 1, columns: [] }
    db.tableRows.mockResolvedValueOnce(casesPage)

    const { result, rerender } = renderHook(
      ({ table }: { table: string }) =>
        useQuery(dbTableRowsQueryOptions({ table, offset: 0, limit: 50 })),
      { wrapper, initialProps: { table: 'cases' } }
    )
    await waitFor(() => expect(result.current.data).toEqual(casesPage))

    db.tableRows.mockReturnValueOnce(new Promise(() => {}))
    rerender({ table: 'notes' })

    // Another table's rows under these headings would be a misread, not a
    // stale read: the column set is different.
    expect(result.current.data).toBeUndefined()
    expect(result.current.isPending).toBe(true)
  })
})

describe('useDbAdminMutations', () => {
  it('wires each mutation to the matching bridge method', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useDbAdminMutations(), { wrapper })

    await act(async () => {
      await result.current.createRow.mutateAsync({ table: 'tags', data: { name: 'x' } })
      await result.current.updateRow.mutateAsync({
        table: 'tags',
        pk: { id: '1' },
        data: { name: 'y' }
      })
      await result.current.deleteRow.mutateAsync({ table: 'tags', pk: { id: '1' } })
      await result.current.vacuum.mutateAsync()
      await result.current.rebuildFts.mutateAsync()
      await result.current.purgeArchived.mutateAsync()
      await result.current.findOrphans.mutateAsync()
      await result.current.cleanOrphans.mutateAsync(ORPHANS)
      await result.current.backup.mutateAsync()
      await result.current.restore.mutateAsync()
      await result.current.exportTable.mutateAsync({ table: 'cases', format: 'csv' })
    })

    expect(db.createRow).toHaveBeenCalledWith({ table: 'tags', data: { name: 'x' } })
    expect(db.updateRow).toHaveBeenCalledWith({
      table: 'tags',
      pk: { id: '1' },
      data: { name: 'y' }
    })
    expect(db.deleteRow).toHaveBeenCalledWith({ table: 'tags', pk: { id: '1' } })
    expect(db.vacuum).toHaveBeenCalled()
    expect(db.rebuildFts).toHaveBeenCalled()
    expect(db.purgeArchived).toHaveBeenCalled()
    expect(db.findOrphans).toHaveBeenCalled()
    expect(db.cleanOrphans).toHaveBeenCalledWith(ORPHANS)
    expect(db.backup).toHaveBeenCalled()
    expect(db.restore).toHaveBeenCalled()
    expect(db.exportTable).toHaveBeenCalledWith({ table: 'cases', format: 'csv' })
  })

  it('names the operation in meta.action so a failure toast is specific', async () => {
    const { client, wrapper } = setup()
    const { result } = renderHook(() => useDbAdminMutations(), { wrapper })

    await act(async () => {
      await result.current.vacuum.mutateAsync()
    })

    const [mutation] = client.getMutationCache().getAll()
    expect(failureMessage(mutation)).toBe("Couldn't vacuum the database.")
  })
})

// --- Invalidation table ----------------------------------------------------
// Asserted against the options factory rather than the hook: no mount, and the
// blast radius of each command is the whole point of the assertion.

type MutationName = keyof ReturnType<typeof dbAdminMutationOptions>

async function runMutation(name: MutationName, variables?: unknown) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue()
  const cache = client.getMutationCache()
  // The 11 option objects take 11 different variable types, so the union
  // defeats build()'s inference. Widening to build's own parameter type keeps
  // the call honest — it still runs mutationFn and fires onSuccess only on
  // success — while MutationName above pins the keys.
  const options = dbAdminMutationOptions(client)[name] as Parameters<typeof cache.build>[1]
  await cache.build(client, options).execute(variables as never)
  return invalidate
}

// null means "called with no filter", i.e. every cached query.
function invalidatedKeys(spy: Awaited<ReturnType<typeof runMutation>>) {
  return spy.mock.calls.map((call) => (call[0] as { queryKey?: unknown })?.queryKey ?? null)
}

describe('dbAdminMutationOptions invalidation', () => {
  it.each([
    ['restore', undefined],
    ['purgeArchived', undefined],
    ['cleanOrphans', ORPHANS]
  ] as const)('%s drops every cached query', async (name, variables) => {
    const spy = await runMutation(name, variables)
    // The point of the no-filter call: these rewrite rows the rest of the app
    // has cached under keys this module has never heard of.
    expect(invalidatedKeys(spy)).toEqual([null])
  })

  it.each([
    ['createRow', { table: 'tags', data: { name: 'x' } }],
    ['updateRow', { table: 'tags', pk: { id: '1' }, data: { name: 'y' } }],
    ['deleteRow', { table: 'tags', pk: { id: '1' } }]
  ] as const)('%s refreshes the browse pages and the stats panel', async (name, variables) => {
    const keys = invalidatedKeys(await runMutation(name, variables))
    expect(keys).toContainEqual(['dbStats'])
    // The page-agnostic prefix, so an edit on page 3 does not leave page 1 stale.
    expect(keys).toContainEqual(['dbTableRows'])
  })

  it.each([
    ['vacuum', undefined],
    ['backup', undefined]
  ] as const)('%s refreshes only the stats panel', async (name, variables) => {
    expect(invalidatedKeys(await runMutation(name, variables))).toEqual([['dbStats']])
  })

  it.each([
    ['rebuildFts', undefined],
    ['findOrphans', undefined],
    ['exportTable', { table: 'cases', format: 'csv' }]
  ] as const)('%s invalidates nothing', async (name, variables) => {
    // None of them changes a row or a byte count: rebuildFts reindexes what is
    // already cached correctly, findOrphans is a read, and exportTable writes
    // its file outside the database.
    expect(invalidatedKeys(await runMutation(name, variables))).toEqual([])
  })

  // Each of these three opens a file dialog before it touches anything and
  // resolves — does not reject — when the operator dismisses it. Nothing
  // happened, so nothing may be invalidated: an unconditional onSuccess turns
  // pressing Escape into an app-wide refetch.
  it('invalidates nothing when the backup dialog is dismissed', async () => {
    db.backup.mockResolvedValue(null)
    expect(invalidatedKeys(await runMutation('backup'))).toEqual([])
  })

  it('invalidates nothing when the restore dialog is dismissed', async () => {
    db.restore.mockResolvedValue({ restored: false })
    expect(invalidatedKeys(await runMutation('restore'))).toEqual([])
  })

  it('invalidates nothing when the export dialog is dismissed', async () => {
    db.exportTable.mockResolvedValue(null)
    const spy = await runMutation('exportTable', { table: 'cases', format: 'csv' })
    expect(invalidatedKeys(spy)).toEqual([])
  })
})
