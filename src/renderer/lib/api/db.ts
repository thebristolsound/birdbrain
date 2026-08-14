import { useMutation, useQueryClient, queryOptions } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type {
  DbTableRowsParams,
  DbCreateRowParams,
  DbUpdateRowParams,
  DbRowIdentifier,
  DbExportTableParams,
  OrphanReport
} from '@shared/ipc'
import { queryKeys } from '@renderer/lib/api/keys'

export const dbStatsQueryOptions = queryOptions({
  queryKey: queryKeys.dbStats,
  queryFn: () => window.birdbrain.db.stats()
})

export const dbSnapshotsQueryOptions = queryOptions({
  queryKey: queryKeys.dbSnapshots,
  queryFn: () => window.birdbrain.db.snapshots()
})

export const dbTableRowsQueryOptions = (params: DbTableRowsParams) =>
  queryOptions({
    queryKey: queryKeys.dbTableRows(params.table, params.offset, params.limit),
    queryFn: () => window.birdbrain.db.tableRows(params),
    // Page switches move to a not-yet-cached key; without a placeholder, data
    // goes undefined and the table/pager disappear until the fetch resolves.
    // Scoped to one table: the table name sits at index 2 of the key. Rows,
    // headings and the row count all come from this one result, so a frame held
    // across a table switch is entirely the table you just left — internally
    // consistent, unmarked as stale, and sitting under a selector that already
    // reads the new table. That is a misread rather than a stale read.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === params.table ? previous : undefined
  })

// restore/purgeArchived/cleanOrphans mutate rows across every table, so a
// targeted invalidation would leave unrelated caches serving deleted rows.
export function dbAdminMutationOptions(queryClient: QueryClient) {
  const invalidateAll = () => {
    queryClient.invalidateQueries()
  }
  const invalidateStats = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.dbStats })
  }
  const invalidateStatsAndRows = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.dbStats })
    queryClient.invalidateQueries({ queryKey: ['db', 'tableRows'] })
  }

  return {
    vacuum: {
      mutationFn: () => window.birdbrain.db.vacuum(),
      onSuccess: invalidateStats,
      meta: { action: 'vacuum the database' }
    },
    rebuildFts: {
      mutationFn: () => window.birdbrain.db.rebuildFts(),
      onSuccess: invalidateStats,
      meta: { action: 'rebuild the search index' }
    },
    // backup resolves to null and restore to { restored: false } when the user
    // cancels the native dialog, so the invalidation has to be guarded on the
    // result — otherwise cancelling a restore fires an unfiltered, app-wide
    // refetch. Only the committed backup path checkpoints the WAL, which is
    // what moves the file sizes in the stats panel.
    backup: {
      mutationFn: () => window.birdbrain.db.backup(),
      onSuccess: (result: { path: string } | null) => {
        if (result) invalidateStats()
      },
      meta: { action: 'back up the database' }
    },
    // No invalidation at all: the handler SELECTs the table and writes a file
    // outside the database. Nothing db.stats() reports — schema version, file
    // and WAL sizes, row counts — can move.
    exportTable: {
      mutationFn: (params: DbExportTableParams) => window.birdbrain.db.exportTable(params),
      meta: { action: 'export the table' }
    },
    findOrphans: {
      mutationFn: () => window.birdbrain.db.findOrphans(),
      meta: { action: 'find orphaned records' }
    },
    purgeArchived: {
      mutationFn: () => window.birdbrain.db.purgeArchived(),
      onSuccess: invalidateAll,
      meta: { action: 'purge archived records' }
    },
    cleanOrphans: {
      mutationFn: (report: OrphanReport) => window.birdbrain.db.cleanOrphans(report),
      onSuccess: invalidateAll,
      meta: { action: 'clean up orphaned records' }
    },
    restore: {
      mutationFn: () => window.birdbrain.db.restore(),
      onSuccess: (result: { restored: boolean }) => {
        if (result.restored) invalidateAll()
      },
      meta: { action: 'restore the database' }
    },
    // A snapshot restore replaces every table, and re-opening the database can
    // migrate the restored file forward — which writes a new snapshot. Both the
    // app-wide caches and the snapshot list are stale afterwards.
    //
    // onSettled, not onSuccess: a restore reports failure from several points,
    // including after the file has been replaced and re-opened. Leaving the
    // caches alone on failure keeps the case list from before the restore on
    // screen over a database that may no longer hold it.
    restoreSnapshot: {
      mutationFn: (fileName: string) => window.birdbrain.db.restoreSnapshot({ fileName }),
      onSettled: invalidateAll,
      meta: { action: 'restore the database snapshot' }
    },
    createRow: {
      mutationFn: (params: DbCreateRowParams) => window.birdbrain.db.createRow(params),
      onSuccess: invalidateStatsAndRows,
      meta: { action: 'create the row' }
    },
    updateRow: {
      mutationFn: (params: DbUpdateRowParams) => window.birdbrain.db.updateRow(params),
      onSuccess: invalidateStatsAndRows,
      meta: { action: 'save the row' }
    },
    deleteRow: {
      mutationFn: (params: DbRowIdentifier) => window.birdbrain.db.deleteRow(params),
      onSuccess: invalidateStatsAndRows,
      meta: { action: 'delete the row' }
    }
  }
}

export function useDbAdminMutations() {
  const queryClient = useQueryClient()
  const opts = dbAdminMutationOptions(queryClient)
  return {
    vacuum: useMutation(opts.vacuum),
    rebuildFts: useMutation(opts.rebuildFts),
    purgeArchived: useMutation(opts.purgeArchived),
    findOrphans: useMutation(opts.findOrphans),
    cleanOrphans: useMutation(opts.cleanOrphans),
    backup: useMutation(opts.backup),
    restore: useMutation(opts.restore),
    restoreSnapshot: useMutation(opts.restoreSnapshot),
    exportTable: useMutation(opts.exportTable),
    createRow: useMutation(opts.createRow),
    updateRow: useMutation(opts.updateRow),
    deleteRow: useMutation(opts.deleteRow)
  }
}
