import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueryClient,
  type QueryClient
} from '@tanstack/react-query'
import type {
  DbCreateRowParams,
  DbUpdateRowParams,
  DbRowIdentifier,
  DbExportTableParams,
  OrphanReport
} from '@shared/ipc'
import { queryKeys } from '@renderer/lib/api/keys'

export const DB_PAGE_SIZE = 50

export const dbStatsQueryOptions = queryOptions({
  queryKey: queryKeys.dbStats,
  queryFn: () => window.birdbrain.db.stats()
})

export const dbTableRowsQueryOptions = (table: string, page: number) =>
  queryOptions({
    queryKey: queryKeys.dbTableRows(table, page),
    queryFn: () =>
      window.birdbrain.db.tableRows({
        table,
        offset: page * DB_PAGE_SIZE,
        limit: DB_PAGE_SIZE
      }),
    placeholderData: keepPreviousData
  })

// --- Mutation option factories ---
// Plain functions over a QueryClient so invalidation behavior is testable
// without mounting components. `useDbAdminMutations` is a thin hook over them.

const invalidateDbStats = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: queryKeys.dbStats })

const invalidateTableData = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({ queryKey: queryKeys.dbStats })
  queryClient.invalidateQueries({ queryKey: ['dbTableRows'] })
}

export const vacuumMutationOptions = (queryClient: QueryClient) => ({
  mutationFn: () => window.birdbrain.db.vacuum(),
  onSuccess: () => {
    invalidateDbStats(queryClient)
  }
})

export const rebuildFtsMutationOptions = (queryClient: QueryClient) => ({
  mutationFn: () => window.birdbrain.db.rebuildFts(),
  onSuccess: () => {
    invalidateTableData(queryClient)
  }
})

export const purgeArchivedMutationOptions = (queryClient: QueryClient) => ({
  mutationFn: () => window.birdbrain.db.purgeArchived(),
  onSuccess: () => {
    queryClient.invalidateQueries()
  }
})

// Read-only scan — no invalidation needed.
export const findOrphansMutationOptions = () => ({
  mutationFn: () => window.birdbrain.db.findOrphans()
})

export const cleanOrphansMutationOptions = (queryClient: QueryClient) => ({
  mutationFn: (report: OrphanReport) => window.birdbrain.db.cleanOrphans(report),
  onSuccess: () => {
    queryClient.invalidateQueries()
  }
})

export const backupMutationOptions = (queryClient: QueryClient) => ({
  mutationFn: () => window.birdbrain.db.backup(),
  onSuccess: () => {
    invalidateDbStats(queryClient)
  }
})

export const restoreMutationOptions = (queryClient: QueryClient) => ({
  mutationFn: () => window.birdbrain.db.restore(),
  onSuccess: () => {
    queryClient.invalidateQueries()
  }
})

export const exportTableMutationOptions = (queryClient: QueryClient) => ({
  mutationFn: (params: DbExportTableParams) => window.birdbrain.db.exportTable(params),
  onSuccess: () => {
    invalidateDbStats(queryClient)
  }
})

export const createRowMutationOptions = (queryClient: QueryClient) => ({
  mutationFn: (params: DbCreateRowParams) => window.birdbrain.db.createRow(params),
  onSuccess: () => {
    invalidateTableData(queryClient)
  }
})

export const updateRowMutationOptions = (queryClient: QueryClient) => ({
  mutationFn: (params: DbUpdateRowParams) => window.birdbrain.db.updateRow(params),
  onSuccess: () => {
    invalidateTableData(queryClient)
  }
})

export const deleteRowMutationOptions = (queryClient: QueryClient) => ({
  mutationFn: (params: DbRowIdentifier) => window.birdbrain.db.deleteRow(params),
  onSuccess: () => {
    invalidateTableData(queryClient)
  }
})

export function useDbAdminMutations() {
  const queryClient = useQueryClient()

  return {
    vacuum: useMutation(vacuumMutationOptions(queryClient)),
    rebuildFts: useMutation(rebuildFtsMutationOptions(queryClient)),
    purgeArchived: useMutation(purgeArchivedMutationOptions(queryClient)),
    findOrphans: useMutation(findOrphansMutationOptions()),
    cleanOrphans: useMutation(cleanOrphansMutationOptions(queryClient)),
    backup: useMutation(backupMutationOptions(queryClient)),
    restore: useMutation(restoreMutationOptions(queryClient)),
    exportTable: useMutation(exportTableMutationOptions(queryClient)),
    createRow: useMutation(createRowMutationOptions(queryClient)),
    updateRow: useMutation(updateRowMutationOptions(queryClient)),
    deleteRow: useMutation(deleteRowMutationOptions(queryClient))
  }
}
