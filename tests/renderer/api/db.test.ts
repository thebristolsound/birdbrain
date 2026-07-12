// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fakeBridge } from '../fakeBridge'
import { queryKeys } from '@renderer/lib/api/keys'
import {
  DB_PAGE_SIZE,
  dbStatsQueryOptions,
  dbTableRowsQueryOptions,
  vacuumMutationOptions,
  rebuildFtsMutationOptions,
  purgeArchivedMutationOptions,
  findOrphansMutationOptions,
  cleanOrphansMutationOptions,
  backupMutationOptions,
  restoreMutationOptions,
  exportTableMutationOptions,
  createRowMutationOptions,
  updateRowMutationOptions,
  deleteRowMutationOptions,
  useDbAdminMutations
} from '@renderer/lib/api/db'

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
  return { queryClient, invalidate }
}

function invalidatedKeys(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.map((c) => (c[0] as { queryKey: unknown } | undefined)?.queryKey)
}

describe('fakeBridge', () => {
  it('throws a descriptive error for unstubbed methods', async () => {
    fakeBridge()
    await expect(window.birdbrain.db.vacuum()).rejects.toThrow('fakeBridge: db.vacuum not stubbed')
  })

  it('returns subscribe functions for event methods', () => {
    fakeBridge()
    const unsubscribe = window.birdbrain.onNewCapture(() => {})
    expect(typeof unsubscribe).toBe('function')
  })
})

describe('db query options', () => {
  it('dbStatsQueryOptions wires to db.stats', async () => {
    const stats = vi.fn(async () => ({
      schemaVersion: 12,
      dbFileSize: 1024,
      walFileSize: 0,
      tables: [{ name: 'cases', rowCount: 3 }]
    }))
    fakeBridge({ db: { stats } })

    expect(dbStatsQueryOptions.queryKey).toEqual(queryKeys.dbStats)
    const result = await dbStatsQueryOptions.queryFn?.({} as never)
    expect(stats).toHaveBeenCalled()
    expect(result).toMatchObject({ schemaVersion: 12 })
  })

  it('dbTableRowsQueryOptions pages via offset/limit', async () => {
    const tableRows = vi.fn(async () => ({ rows: [], total: 0, columns: [] }))
    fakeBridge({ db: { tableRows } })

    const opts = dbTableRowsQueryOptions('captures', 2)
    expect(opts.queryKey).toEqual(queryKeys.dbTableRows('captures', 2))
    await opts.queryFn?.({} as never)
    expect(tableRows).toHaveBeenCalledWith({
      table: 'captures',
      offset: 2 * DB_PAGE_SIZE,
      limit: DB_PAGE_SIZE
    })
  })
})

describe('db admin mutation options', () => {
  it('db.restore invalidates all queries', async () => {
    const restore = vi.fn(async () => ({ restored: true }))
    fakeBridge({ db: { restore } })
    const { queryClient, invalidate } = setup()

    const opts = restoreMutationOptions(queryClient)
    await expect(opts.mutationFn()).resolves.toEqual({ restored: true })
    opts.onSuccess()
    expect(invalidate).toHaveBeenCalledWith() // no filter = invalidate everything
  })

  it('db.cleanOrphans and db.purgeArchived invalidate all queries', async () => {
    const cleanOrphans = vi.fn(async () => ({ dbRecordsRemoved: 1, filesRemoved: 2 }))
    const purgeArchived = vi.fn(async () => ({ casesDeleted: 1, capturesDeleted: 4 }))
    fakeBridge({ db: { cleanOrphans, purgeArchived } })
    const { queryClient, invalidate } = setup()

    const report = { dbOrphans: [], fileOrphans: [] }
    const clean = cleanOrphansMutationOptions(queryClient)
    await clean.mutationFn(report)
    expect(cleanOrphans).toHaveBeenCalledWith(report)
    clean.onSuccess()
    expect(invalidate).toHaveBeenCalledWith()

    invalidate.mockClear()
    const purge = purgeArchivedMutationOptions(queryClient)
    await purge.mutationFn()
    purge.onSuccess()
    expect(invalidate).toHaveBeenCalledWith()
  })

  it('db.vacuum invalidates dbStats only', async () => {
    const vacuum = vi.fn(async () => ({ freedBytes: 2048 }))
    fakeBridge({ db: { vacuum } })
    const { queryClient, invalidate } = setup()

    const opts = vacuumMutationOptions(queryClient)
    await expect(opts.mutationFn()).resolves.toEqual({ freedBytes: 2048 })
    opts.onSuccess()
    expect(invalidatedKeys(invalidate)).toEqual([queryKeys.dbStats])
  })

  it('db.backup and db.exportTable invalidate dbStats only', async () => {
    const backup = vi.fn(async () => ({ path: 'C:/backup.db' }))
    const exportTable = vi.fn(async () => ({ path: 'C:/cases.csv' }))
    fakeBridge({ db: { backup, exportTable } })
    const { queryClient, invalidate } = setup()

    const backupOpts = backupMutationOptions(queryClient)
    await backupOpts.mutationFn()
    backupOpts.onSuccess()
    expect(invalidatedKeys(invalidate)).toEqual([queryKeys.dbStats])

    invalidate.mockClear()
    const exportOpts = exportTableMutationOptions(queryClient)
    await exportOpts.mutationFn({ table: 'cases', format: 'csv' })
    expect(exportTable).toHaveBeenCalledWith({ table: 'cases', format: 'csv' })
    exportOpts.onSuccess()
    expect(invalidatedKeys(invalidate)).toEqual([queryKeys.dbStats])
  })

  it('db.deleteRow invalidates dbStats and dbTableRows', async () => {
    const deleteRow = vi.fn(async () => true)
    fakeBridge({ db: { deleteRow } })
    const { queryClient, invalidate } = setup()

    const opts = deleteRowMutationOptions(queryClient)
    await opts.mutationFn({ table: 'notes', pk: { id: 'n1' } })
    expect(deleteRow).toHaveBeenCalledWith({ table: 'notes', pk: { id: 'n1' } })
    opts.onSuccess()
    const keys = invalidatedKeys(invalidate)
    expect(keys).toContainEqual(queryKeys.dbStats)
    expect(keys).toContainEqual(['dbTableRows'])
  })

  it('db.createRow and db.updateRow invalidate dbStats and dbTableRows', async () => {
    const createRow = vi.fn(async () => ({ id: 'x' }))
    const updateRow = vi.fn(async () => true)
    fakeBridge({ db: { createRow, updateRow } })
    const { queryClient, invalidate } = setup()

    const createOpts = createRowMutationOptions(queryClient)
    await createOpts.mutationFn({ table: 'tags', data: { name: 't' } })
    createOpts.onSuccess()
    let keys = invalidatedKeys(invalidate)
    expect(keys).toContainEqual(queryKeys.dbStats)
    expect(keys).toContainEqual(['dbTableRows'])

    invalidate.mockClear()
    const updateOpts = updateRowMutationOptions(queryClient)
    await updateOpts.mutationFn({ table: 'tags', pk: { id: 't1' }, data: { name: 'u' } })
    expect(updateRow).toHaveBeenCalledWith({ table: 'tags', pk: { id: 't1' }, data: { name: 'u' } })
    updateOpts.onSuccess()
    keys = invalidatedKeys(invalidate)
    expect(keys).toContainEqual(queryKeys.dbStats)
    expect(keys).toContainEqual(['dbTableRows'])
  })

  it('db.rebuildFts invalidates dbStats and dbTableRows', async () => {
    const rebuildFts = vi.fn(async () => ({ rowsIndexed: 42 }))
    fakeBridge({ db: { rebuildFts } })
    const { queryClient, invalidate } = setup()

    const opts = rebuildFtsMutationOptions(queryClient)
    await expect(opts.mutationFn()).resolves.toEqual({ rowsIndexed: 42 })
    opts.onSuccess()
    const keys = invalidatedKeys(invalidate)
    expect(keys).toContainEqual(queryKeys.dbStats)
    expect(keys).toContainEqual(['dbTableRows'])
  })

  it('db.findOrphans is a read-only scan with no invalidation', async () => {
    const report = { dbOrphans: [], fileOrphans: ['stray.png'] }
    const findOrphans = vi.fn(async () => report)
    fakeBridge({ db: { findOrphans } })
    const { invalidate } = setup()

    const opts = findOrphansMutationOptions()
    await expect(opts.mutationFn()).resolves.toEqual(report)
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('useDbAdminMutations', () => {
  it('exposes all 11 admin operations backed by the option factories', async () => {
    const vacuum = vi.fn(async () => ({ freedBytes: 0 }))
    fakeBridge({ db: { vacuum } })
    const { queryClient, invalidate } = setup()
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)

    const { result } = renderHook(() => useDbAdminMutations(), { wrapper })
    for (const op of [
      'vacuum',
      'rebuildFts',
      'purgeArchived',
      'findOrphans',
      'cleanOrphans',
      'backup',
      'restore',
      'exportTable',
      'createRow',
      'updateRow',
      'deleteRow'
    ] as const) {
      expect(result.current[op]).toBeDefined()
    }

    await result.current.vacuum.mutateAsync()
    expect(vacuum).toHaveBeenCalled()
    expect(invalidatedKeys(invalidate)).toEqual([queryKeys.dbStats])
  })
})
