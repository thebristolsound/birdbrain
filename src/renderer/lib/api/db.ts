import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
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
 * Every write and maintenance command in the `db` namespace, as mutation
 * options. Split out from the hook so the invalidation table below is
 * assertable without mounting React.
 *
 * `meta.action` is not decoration: the global MutationCache handler in
 * queryClient.ts renders it as "Couldn't <action>.", so an omitted one degrades
 * a specific failure toast into a generic one.
 */
export function dbAdminMutationOptions(queryClient: QueryClient) {
  const invalidateStats = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.dbStats })
  }

  // Row counts and file size move with the rows, so a row write refreshes both
  // the browse pages and the stats panel.
  const invalidateRows = () => {
    invalidateStats()
    void queryClient.invalidateQueries({ queryKey: queryKeys.dbTableRowsAll })
  }

  // Restore swaps the whole file; purge and orphan cleanup delete across cases,
  // captures, tags, selectors and notes at once. Enumerating the affected keys
  // would be a list that silently rots as domains are added, so these blow away
  // every cache entry instead.
  const invalidateEverything = () => {
    void queryClient.invalidateQueries()
  }

  return {
    createRow: {
      mutationFn: (params: DbCreateRowParams) => window.birdbrain.db.createRow(params),
      onSuccess: invalidateRows,
      meta: { action: 'create the row' }
    },
    updateRow: {
      mutationFn: (params: DbUpdateRowParams) => window.birdbrain.db.updateRow(params),
      onSuccess: invalidateRows,
      meta: { action: 'save the row' }
    },
    deleteRow: {
      mutationFn: (params: DbRowIdentifier) => window.birdbrain.db.deleteRow(params),
      onSuccess: invalidateRows,
      meta: { action: 'delete the row' }
    },
    vacuum: {
      mutationFn: () => window.birdbrain.db.vacuum(),
      onSuccess: invalidateStats,
      meta: { action: 'vacuum the database' }
    },
    rebuildFts: {
      mutationFn: () => window.birdbrain.db.rebuildFts(),
      meta: { action: 'rebuild the search indexes' }
    },
    purgeArchived: {
      mutationFn: () => window.birdbrain.db.purgeArchived(),
      onSuccess: invalidateEverything,
      meta: { action: 'purge archived cases' }
    },
    findOrphans: {
      mutationFn: () => window.birdbrain.db.findOrphans(),
      meta: { action: 'scan for orphans' }
    },
    cleanOrphans: {
      mutationFn: (report: OrphanReport) => window.birdbrain.db.cleanOrphans(report),
      onSuccess: invalidateEverything,
      meta: { action: 'clean up orphans' }
    },
    backup: {
      mutationFn: () => window.birdbrain.db.backup(),
      onSuccess: invalidateStats,
      meta: { action: 'back up the database' }
    },
    restore: {
      mutationFn: () => window.birdbrain.db.restore(),
      onSuccess: invalidateEverything,
      meta: { action: 'restore the database' }
    },
    exportTable: {
      mutationFn: (params: DbExportTableParams) => window.birdbrain.db.exportTable(params),
      onSuccess: invalidateStats,
      meta: { action: 'export the table' }
    }
  }
}

export function useDbAdminMutations() {
  const options = dbAdminMutationOptions(useQueryClient())

  return {
    createRow: useMutation(options.createRow),
    updateRow: useMutation(options.updateRow),
    deleteRow: useMutation(options.deleteRow),
    vacuum: useMutation(options.vacuum),
    rebuildFts: useMutation(options.rebuildFts),
    purgeArchived: useMutation(options.purgeArchived),
    findOrphans: useMutation(options.findOrphans),
    cleanOrphans: useMutation(options.cleanOrphans),
    backup: useMutation(options.backup),
    restore: useMutation(options.restore),
    exportTable: useMutation(options.exportTable)
  }
}
