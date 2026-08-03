import { queryOptions } from '@tanstack/react-query'
import { queryKeys } from '@renderer/lib/api/keys'

// The `app` bridge namespace. Separate from system.ts, which the design
// reserves for one-shot commands with no cache identity — this is a cached
// read.
export const appVersionQueryOptions = queryOptions({
  queryKey: queryKeys.appVersion,
  queryFn: () => window.birdbrain.app.getVersion(),
  staleTime: Infinity
})
