import { queryOptions } from '@tanstack/react-query'
import { queryKeys } from '@renderer/lib/api/keys'

// Whether a VPN is seen on this computer's route, for the top-bar indicator (ADR-0032). A VPN
// connects and drops outside Birdbrain, so the indicator polls, and reads again when the
// window regains focus.
export const VPN_STATUS_POLL_MS = 30_000

export const vpnStatusQueryOptions = queryOptions({
  queryKey: queryKeys.vpnStatus,
  queryFn: () => window.birdbrain.egress.vpnStatus(),
  refetchInterval: VPN_STATUS_POLL_MS,
  refetchOnWindowFocus: true
})
