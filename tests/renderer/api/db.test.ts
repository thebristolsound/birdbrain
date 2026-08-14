import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { DbTableRowsResult } from '@shared/ipc'
import { fakeBridge } from '../fakeBridge'
import { dbStatsQueryOptions, dbTableRowsQueryOptions, dbAdminMutationOptions } from '@renderer/lib/api/db'
import { queryKeys } from '@renderer/lib/api/keys'

function installDbBridge() {
  const fn = () => vi.fn().mockResolvedValue('ok')
  const api = {
    stats: fn(),
    tableRows: fn(),
    createRow: fn(),
    updateRow: fn(),
    deleteRow: fn(),
    vacuum: fn(),
    rebuildFts: fn(),
    purgeArchived: fn(),
    findOrphans: fn(),
    cleanOrphans: fn(),
    backup: fn(),
    restore: fn(),
    snapshots: fn(),
    restoreSnapshot: fn(),
    exportTable: fn()
  }
  fakeBridge({ db: api })
  return api
}

type DbTableRowsKey = ReturnType<typeof queryKeys.dbTableRows>

let api: ReturnType<typeof installDbBridge>

beforeEach(() => {
  api = installDbBridge()
})

function invalidatedKeys(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.map((c) => (c[0] as { queryKey: unknown } | undefined)?.queryKey)
}

describe('queryKeys db', () => {
  it('produces stable keys', () => {
    expect(queryKeys.dbStats).toEqual(['db', 'stats'])
    expect(queryKeys.dbTableRows('cases', 0, 50)).toEqual(['db', 'tableRows', 'cases', 0, 50])
  })
})

describe('dbStatsQueryOptions / dbTableRowsQueryOptions', () => {
  it('wire to window.birdbrain.db', async () => {
    await dbStatsQueryOptions.queryFn?.({} as never)
    expect(api.stats).toHaveBeenCalled()

    const opts = dbTableRowsQueryOptions({ table: 'cases', offset: 0, limit: 50 })
    expect(opts.queryKey).toEqual(['db', 'tableRows', 'cases', 0, 50])
    await opts.queryFn?.({} as never)
    expect(api.tableRows).toHaveBeenCalledWith({ table: 'cases', offset: 0, limit: 50 })
  })

  // Paging holds the previous page on screen so the pager does not unmount
  // under the cursor, but that placeholder has to stop at the table boundary: a
  // held frame is self-consistent and unmarked, so across a table switch it
  // reads as the contents of whatever table the selector now shows.
  it('holds the previous page only within the same table', () => {
    const previous = { rows: [{ id: 'a' }], total: 100, columns: [] }
    const { placeholderData } = dbTableRowsQueryOptions({ table: 'cases', offset: 50, limit: 50 })
    if (typeof placeholderData !== 'function') throw new Error('expected a placeholder function')

    // Real Query instances built through the cache, so the argument is the
    // object React Query actually hands the placeholder rather than a stub cast
    // past the contract.
    const qc = new QueryClient()
    const previousQuery = (table: string) =>
      qc
        .getQueryCache()
        .build<DbTableRowsResult, Error, DbTableRowsResult, DbTableRowsKey>(qc, {
          queryKey: queryKeys.dbTableRows(table, 0, 50)
        })

    expect(placeholderData(previous, previousQuery('cases'))).toEqual(previous)
    expect(placeholderData(previous, previousQuery('notes'))).toBeUndefined()
    expect(placeholderData(previous, undefined)).toBeUndefined()
  })
})

describe('dbAdminMutationOptions', () => {
  it('vacuum invalidates only dbStats', async () => {
    api.vacuum.mockResolvedValue({ freedBytes: 1024 })
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')

    const opts = dbAdminMutationOptions(qc).vacuum
    const data = await opts.mutationFn()
    opts.onSuccess?.(data, undefined as never, undefined, undefined as never)

    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.dbStats })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('rebuildFts invalidates only dbStats', async () => {
    api.rebuildFts.mockResolvedValue({ rowsIndexed: 1, textsHealed: 0 })
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')

    const opts = dbAdminMutationOptions(qc).rebuildFts
    const data = await opts.mutationFn()
    opts.onSuccess?.(data, undefined as never, undefined, undefined as never)

    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.dbStats })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('backup invalidates only dbStats', async () => {
    api.backup.mockResolvedValue({ path: '/tmp/backup.sqlite' })
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')

    const opts = dbAdminMutationOptions(qc).backup
    const data = await opts.mutationFn()
    opts.onSuccess?.(data, undefined as never, undefined, undefined as never)

    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.dbStats })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  // The handler SELECTs the table and writes the file outside the database, so
  // none of the figures db.stats() reports can move — not even on the committed
  // path, which is why this needs no cancellation guard the way backup does.
  it('exportTable invalidates nothing', async () => {
    api.exportTable.mockResolvedValue({ path: '/tmp/cases.csv' })
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')

    const opts = dbAdminMutationOptions(qc).exportTable
    await opts.mutationFn({ table: 'cases', format: 'csv' })

    expect(api.exportTable).toHaveBeenCalledWith({ table: 'cases', format: 'csv' })
    expect('onSuccess' in opts).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('createRow/updateRow/deleteRow invalidate dbStats and tableRows', async () => {
    api.createRow.mockResolvedValue({ id: '1' })
    api.updateRow.mockResolvedValue(true)
    api.deleteRow.mockResolvedValue(true)
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')

    const opts = dbAdminMutationOptions(qc)

    await opts.createRow.mutationFn({ table: 'cases', data: { name: 'x' } })
    opts.createRow.onSuccess?.({}, undefined as never, undefined, undefined as never)
    expect(invalidatedKeys(spy)).toContainEqual(queryKeys.dbStats)
    expect(invalidatedKeys(spy)).toContainEqual(['db', 'tableRows'])

    spy.mockClear()
    await opts.updateRow.mutationFn({ table: 'cases', pk: { id: '1' }, data: { name: 'y' } })
    opts.updateRow.onSuccess?.(true, undefined as never, undefined, undefined as never)
    expect(invalidatedKeys(spy)).toContainEqual(queryKeys.dbStats)
    expect(invalidatedKeys(spy)).toContainEqual(['db', 'tableRows'])

    spy.mockClear()
    await opts.deleteRow.mutationFn({ table: 'cases', pk: { id: '1' } })
    opts.deleteRow.onSuccess?.(true, undefined as never, undefined, undefined as never)
    expect(invalidatedKeys(spy)).toContainEqual(queryKeys.dbStats)
    expect(invalidatedKeys(spy)).toContainEqual(['db', 'tableRows'])
  })

  it('findOrphans is a read-only report with no invalidation', () => {
    const qc = new QueryClient()
    const opts = dbAdminMutationOptions(qc).findOrphans
    expect(opts.onSuccess).toBeUndefined()
  })

  it('restore invalidates every query', async () => {
    api.restore.mockResolvedValue({ restored: true })
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')

    const opts = dbAdminMutationOptions(qc).restore
    const data = await opts.mutationFn()
    opts.onSuccess?.(data, undefined as never, undefined, undefined as never)

    expect(spy).toHaveBeenCalledWith()
  })

  it('restoreSnapshot invalidates every query, including when the restore failed', async () => {
    api.restoreSnapshot.mockResolvedValue({ restored: true })
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')

    const opts = dbAdminMutationOptions(qc).restoreSnapshot
    const data = await opts.mutationFn('pre-migration-v26-to-v27-2026-08-01T09-00-00-000Z.db')
    opts.onSettled?.(data, null, '', undefined as never)

    // The wrapping is the only thing this mutationFn adds over a direct bridge
    // call, and the handler reads `params.fileName` — a bare string or a wrong
    // key fails at runtime, not here, unless it is asserted.
    expect(api.restoreSnapshot).toHaveBeenCalledWith({
      fileName: 'pre-migration-v26-to-v27-2026-08-01T09-00-00-000Z.db'
    })
    expect(spy).toHaveBeenCalledWith()

    // A restore reports failure from several points, some of them after the
    // file has been replaced and re-opened. Invalidating only on success would
    // leave the case list from before the restore on screen over a database
    // that may no longer hold it.
    spy.mockClear()
    expect(opts.onSuccess).toBeUndefined()
    opts.onSettled?.(undefined, new Error('restore failed'), '', undefined as never)
    expect(spy).toHaveBeenCalledWith()
  })

  it('purgeArchived invalidates every query', async () => {
    api.purgeArchived.mockResolvedValue({ casesDeleted: 1, capturesDeleted: 2 })
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')

    const opts = dbAdminMutationOptions(qc).purgeArchived
    const data = await opts.mutationFn()
    opts.onSuccess?.(data, undefined as never, undefined, undefined as never)

    expect(spy).toHaveBeenCalledWith()
  })

  it('cleanOrphans invalidates every query', async () => {
    api.cleanOrphans.mockResolvedValue({ dbRecordsRemoved: 1, filesRemoved: 1 })
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')

    const report = { dbOrphans: [], fileOrphans: [] }
    const opts = dbAdminMutationOptions(qc).cleanOrphans
    const data = await opts.mutationFn(report)
    opts.onSuccess?.(data, undefined as never, undefined, undefined as never)

    expect(spy).toHaveBeenCalledWith()
  })
})

// The native dialogs resolve rather than reject when dismissed, so a cancelled
// operation reaches onSuccess like a real one. Cancelling a restore in
// particular used to fire an unfiltered invalidateQueries() — an app-wide
// refetch for an operation that changed nothing.
describe('dbAdminMutationOptions cancellation', () => {
  it('backup does not invalidate when the save dialog is cancelled', async () => {
    api.backup.mockResolvedValue(null)
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')

    const opts = dbAdminMutationOptions(qc).backup
    const data = await opts.mutationFn()
    opts.onSuccess?.(data, undefined as never, undefined, undefined as never)

    expect(spy).not.toHaveBeenCalled()
  })

  it('restore does not invalidate when the open dialog is cancelled', async () => {
    api.restore.mockResolvedValue({ restored: false })
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')

    const opts = dbAdminMutationOptions(qc).restore
    const data = await opts.mutationFn()
    opts.onSuccess?.(data, undefined as never, undefined, undefined as never)

    expect(spy).not.toHaveBeenCalled()
  })
})
