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

export const dbTableRowsQueryOptions = (params: DbTableRowsParams) =>
  queryOptions({
    queryKey: queryKeys.dbTableRows(params.table, params.offset, params.limit),
    queryFn: () => window.birdbrain.db.tableRows(params)
  })

export function dbAdminMutationOptions(queryClient: QueryClient) {
  const invalidateStats = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.dbStats })
  }
  const invalidateStatsAndRows = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.dbStats })
    queryClient.invalidateQueries({ queryKey: ['db', 'tableRows'] })
  }

  return {
    vacuum: { mutationFn: () => window.birdbrain.db.vacuum(), onSuccess: invalidateStats },
    rebuildFts: { mutationFn: () => window.birdbrain.db.rebuildFts(), onSuccess: invalidateStats },
    backup: { mutationFn: () => window.birdbrain.db.backup(), onSuccess: invalidateStats },
    exportTable: {
      mutationFn: (params: DbExportTableParams) => window.birdbrain.db.exportTable(params),
      onSuccess: invalidateStats
    },
    findOrphans: { mutationFn: () => window.birdbrain.db.findOrphans() },
    purgeArchived: { mutationFn: () => window.birdbrain.db.purgeArchived() },
    cleanOrphans: {
      mutationFn: (report: OrphanReport) => window.birdbrain.db.cleanOrphans(report)
    },
    restore: { mutationFn: () => window.birdbrain.db.restore() },
    createRow: {
      mutationFn: (params: DbCreateRowParams) => window.birdbrain.db.createRow(params),
      onSuccess: invalidateStatsAndRows
    },
    updateRow: {
      mutationFn: (params: DbUpdateRowParams) => window.birdbrain.db.updateRow(params),
      onSuccess: invalidateStatsAndRows
    },
    deleteRow: {
      mutationFn: (params: DbRowIdentifier) => window.birdbrain.db.deleteRow(params),
      onSuccess: invalidateStatsAndRows
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
    exportTable: useMutation(opts.exportTable),
    createRow: useMutation(opts.createRow),
    updateRow: useMutation(opts.updateRow),
    deleteRow: useMutation(opts.deleteRow)
  }
}
