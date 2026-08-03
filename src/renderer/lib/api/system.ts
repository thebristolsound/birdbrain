import { queryOptions } from '@tanstack/react-query'
import { queryKeys } from '@renderer/lib/api/keys'

export const appVersionQueryOptions = queryOptions({
  queryKey: queryKeys.appVersion,
  queryFn: () => window.birdbrain.app.getVersion(),
  staleTime: Infinity
})
