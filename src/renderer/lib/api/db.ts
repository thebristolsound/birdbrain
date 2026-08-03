import { queryOptions, useMutation } from '@tanstack/react-query'
import type {
  DbCreateRowParams,
  DbExportTableParams,
  DbRowIdentifier,
  DbTableRowsParams,
  DbUpdateRowParams,
  OrphanReport
} from '@shared/ipc'
import { queryKeys } from '@renderer/lib/api/keys'

export const dbStatsQueryOptions = queryOptions({
  queryKey: queryKeys.dbStats,
  queryFn: () => window.birdbrain.db.stats()
})

export const dbTableRowsQueryOptions = (params: DbTableRowsParams) =>
  queryOptions({
    queryKey: queryKeys.dbTableRows(params.table, params.offset, params.limit),
    queryFn: () => window.birdbrain.db.tableRows(params)
  })

/**
 * Every write and maintenance command in the `db` namespace, as mutations.
 *
 * `meta.action` is not decoration: the global MutationCache handler in
 * queryClient.ts renders it as "Couldn't <action>.", so an omitted one degrades
 * a specific failure toast into a generic one.
 */
export function useDbAdminMutations() {
  const createRow = useMutation({
    mutationFn: (params: DbCreateRowParams) => window.birdbrain.db.createRow(params),
    meta: { action: 'create the row' }
  })

  const updateRow = useMutation({
    mutationFn: (params: DbUpdateRowParams) => window.birdbrain.db.updateRow(params),
    meta: { action: 'save the row' }
  })

  const deleteRow = useMutation({
    mutationFn: (params: DbRowIdentifier) => window.birdbrain.db.deleteRow(params),
    meta: { action: 'delete the row' }
  })

  const vacuum = useMutation({
    mutationFn: () => window.birdbrain.db.vacuum(),
    meta: { action: 'vacuum the database' }
  })

  const rebuildFts = useMutation({
    mutationFn: () => window.birdbrain.db.rebuildFts(),
    meta: { action: 'rebuild the search indexes' }
  })

  const purgeArchived = useMutation({
    mutationFn: () => window.birdbrain.db.purgeArchived(),
    meta: { action: 'purge archived cases' }
  })

  const findOrphans = useMutation({
    mutationFn: () => window.birdbrain.db.findOrphans(),
    meta: { action: 'scan for orphans' }
  })

  const cleanOrphans = useMutation({
    mutationFn: (report: OrphanReport) => window.birdbrain.db.cleanOrphans(report),
    meta: { action: 'clean up orphans' }
  })

  const backup = useMutation({
    mutationFn: () => window.birdbrain.db.backup(),
    meta: { action: 'back up the database' }
  })

  const restore = useMutation({
    mutationFn: () => window.birdbrain.db.restore(),
    meta: { action: 'restore the database' }
  })

  const exportTable = useMutation({
    mutationFn: (params: DbExportTableParams) => window.birdbrain.db.exportTable(params),
    meta: { action: 'export the table' }
  })

  return {
    createRow,
    updateRow,
    deleteRow,
    vacuum,
    rebuildFts,
    purgeArchived,
    findOrphans,
    cleanOrphans,
    backup,
    restore,
    exportTable
  }
}
