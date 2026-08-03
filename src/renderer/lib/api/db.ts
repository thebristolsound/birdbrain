import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type {
  DbCreateRowParams,
  DbExportTableParams,
  DbRowIdentifier,
  DbTableRowsParams,
  DbUpdateRowParams,
  IpcInvokeContract,
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
    queryFn: () => window.birdbrain.db.tableRows(params),
    // Paging holds the previous page on screen while the next one loads, so the
    // pager itself does not unmount under the cursor. Scoped to one table: rows
    // from the table you just left under the new table's headings is worse than
    // a blank while it loads, and the column set changes anyway.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === params.table ? previous : undefined
  })

/**
 * Creates React Query mutation options for database writes and maintenance operations.
 *
 * @param queryClient - The query client used to invalidate affected cached queries
 * @returns Mutation configurations for database row, maintenance, backup, restore, and export operations
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
      meta: { action: 'create row' }
    },
    updateRow: {
      mutationFn: (params: DbUpdateRowParams) => window.birdbrain.db.updateRow(params),
      onSuccess: invalidateRows,
      meta: { action: 'save row' }
    },
    deleteRow: {
      mutationFn: (params: DbRowIdentifier) => window.birdbrain.db.deleteRow(params),
      onSuccess: invalidateRows,
      meta: { action: 'delete row' }
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
    // The three file-dialog commands below resolve rather than reject when the
    // user dismisses the picker, and the handler opens the dialog before it
    // touches anything, so a dismissal means nothing happened. Invalidating on
    // the bare fact that the promise settled would refetch the app on Escape.
    backup: {
      // Only the committed path checkpoints the WAL, which is what moves the
      // file sizes in the stats panel.
      mutationFn: () => window.birdbrain.db.backup(),
      onSuccess: (result: IpcInvokeContract['db:backup']['result']) => {
        if (result) invalidateStats()
      },
      meta: { action: 'back up the database' }
    },
    restore: {
      mutationFn: () => window.birdbrain.db.restore(),
      onSuccess: (result: IpcInvokeContract['db:restore']['result']) => {
        if (result.restored) invalidateEverything()
      },
      meta: { action: 'restore the database' }
    },
    // No invalidation at all: exporting reads the table and writes a file
    // outside the database. Nothing db.stats() reports can move.
    exportTable: {
      mutationFn: (params: DbExportTableParams) => window.birdbrain.db.exportTable(params),
      meta: { action: 'export the table' }
    }
  }
}

/**
 * Provides mutation hooks for database administration operations.
 *
 * @returns Mutation hooks for creating, updating, and deleting rows, maintaining the database, managing backups, restoring data, and exporting tables
 */
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
