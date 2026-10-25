import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { BirdbrainAPI } from '@shared/birdbrainApi'
import type { IpcRefusal } from '@shared/ipc'
import { SHARING_ERROR_CODES, type SharingErrorCode } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'

// The Shared Case query layer (#1514): the roster, the sync state, the
// platform check and the invite preview as reads; every sharing command as a
// mutation that refetches what the main process changed. The screens that
// read these live under components/sharing/.

// A refused sharing call rejects with a plain IpcRefusal: the context bridge
// would strip `.code` from an Error (the preload's unwrapIpc). This rebuilds
// the Error, code included, on this side of the bridge; any other rejection
// passes through unchanged.
export function refusalError(err: unknown): unknown {
  if (err instanceof Error || typeof err !== 'object' || err === null) return err
  const { message, code } = err as Partial<IpcRefusal>
  if (typeof message !== 'string') return err
  const error = new Error(message)
  if (typeof code === 'string') Object.assign(error, { code })
  return error
}

// Every sharing read and command goes through here, so the screens only ever
// see Errors.
async function sharing<T>(call: (bridge: BirdbrainAPI['sharing']) => Promise<T>): Promise<T> {
  try {
    return await call(window.birdbrain.sharing)
  } catch (err) {
    throw refusalError(err)
  }
}

export const membersQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.sharingMembers(caseId),
    queryFn: () => sharing((bridge) => bridge.getMembers(caseId)),
    enabled: !!caseId
  })

// Polled while mounted: `phase` reads 'syncing' only during a session, and
// `onSharingChanged` fires when a round ends, not when one begins, so a pill
// that waited for the event would never show the syncing state.
export const SYNC_STATE_POLL_MS = 5000

export const syncStateQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.sharingSyncState(caseId),
    queryFn: () => sharing((bridge) => bridge.getSyncState(caseId)),
    enabled: !!caseId,
    refetchInterval: SYNC_STATE_POLL_MS
  })

// Whether the peer-to-peer binding loads on this machine. Decided once per
// process, so never stale.
export const sharingAvailableQueryOptions = queryOptions({
  queryKey: queryKeys.sharingAvailable,
  queryFn: () => sharing((bridge) => bridge.isAvailable()),
  staleTime: Infinity
})

// Reads an invite offline: who sent it and until when. Nothing is contacted.
export const invitePreviewQueryOptions = (invite: string) =>
  queryOptions({
    queryKey: queryKeys.sharingInvitePreview(invite),
    queryFn: () => sharing((bridge) => bridge.readInvite(invite)),
    enabled: invite.length > 0
  })

// A sharing refusal reaches the screens as an Error carrying the
// SharingErrorCode on `.code` (refusalError above). Null for any other
// rejection, so a screen that names refusals falls back to the message.
export function sharingErrorCode(err: unknown): SharingErrorCode | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) return null
  const { code } = err as { code?: unknown }
  return typeof code === 'string' && (SHARING_ERROR_CODES as readonly string[]).includes(code)
    ? (code as SharingErrorCode)
    : null
}

function invalidateSharing(queryClient: QueryClient, caseId: string): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.sharingMembers(caseId) })
  queryClient.invalidateQueries({ queryKey: queryKeys.sharingSyncState(caseId) })
}

// A chain write by this installation: the ledger reads the new entry.
function invalidateChain(queryClient: QueryClient, caseId: string): void {
  invalidateSharing(queryClient, caseId)
  queryClient.invalidateQueries({ queryKey: queryKeys.manifestSnapshot(caseId) })
}

export function sharingMutationOptions(queryClient: QueryClient) {
  return {
    // The first invite of a Case shares it: the Case gains `sharedAt` and the
    // Owner's chain its `member-add`.
    createInvite: {
      mutationFn: ({ caseId, ownerMemberCode }: { caseId: string; ownerMemberCode?: string }) =>
        sharing((bridge) => bridge.createInvite(caseId, ownerMemberCode)),
      onSuccess: (_data: unknown, { caseId }: { caseId: string }) => {
        invalidateChain(queryClient, caseId)
        queryClient.invalidateQueries({ queryKey: queryKeys.cases })
        queryClient.invalidateQueries({ queryKey: queryKeys.case(caseId) })
      },
      meta: { action: 'create an invite' }
    },
    cancelInvite: {
      mutationFn: ({ caseId, inviteId }: { caseId: string; inviteId: string }) =>
        sharing((bridge) => bridge.cancelInvite(caseId, inviteId)),
      onSuccess: (_data: unknown, { caseId }: { caseId: string }) =>
        invalidateSharing(queryClient, caseId),
      meta: { action: 'cancel the invite' }
    },
    approveJoin: {
      mutationFn: ({
        caseId,
        requestId,
        memberCode
      }: {
        caseId: string
        requestId: string
        memberCode: string
      }) => sharing((bridge) => bridge.approveJoin(caseId, requestId, memberCode)),
      onSuccess: (_data: unknown, { caseId }: { caseId: string }) =>
        invalidateChain(queryClient, caseId),
      meta: { action: 'approve the join' }
    },
    declineJoin: {
      mutationFn: ({ caseId, requestId }: { caseId: string; requestId: string }) =>
        sharing((bridge) => bridge.declineJoin(caseId, requestId)),
      onSuccess: (_data: unknown, { caseId }: { caseId: string }) =>
        invalidateSharing(queryClient, caseId),
      meta: { action: 'decline the join' }
    },
    revoke: {
      mutationFn: ({ caseId, installationId }: { caseId: string; installationId: string }) =>
        sharing((bridge) => bridge.revoke(caseId, installationId)),
      onSuccess: (_data: unknown, { caseId }: { caseId: string }) =>
        invalidateChain(queryClient, caseId),
      meta: { action: 'revoke the member' }
    },
    excludeExhibit: {
      mutationFn: ({
        caseId,
        exhibitId,
        reason
      }: {
        caseId: string
        exhibitId: string
        reason?: string
      }) => sharing((bridge) => bridge.excludeExhibit(caseId, exhibitId, reason)),
      onSuccess: (_data: unknown, { caseId }: { caseId: string }) =>
        invalidateChain(queryClient, caseId),
      meta: { action: 'exclude the Exhibit from export' }
    },
    // A round that brought entries changes the Captures, the inventory and
    // the ledger; `onSharingChanged` refetches them too, so this is only the
    // immediate read after the command resolves.
    syncNow: {
      mutationFn: (caseId: string) => sharing((bridge) => bridge.syncNow(caseId)),
      onSuccess: (_data: unknown, caseId: string) => {
        invalidateSharing(queryClient, caseId)
        queryClient.invalidateQueries({ queryKey: queryKeys.captures(caseId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.captureCounts })
        queryClient.invalidateQueries({ queryKey: queryKeys.exhibitInventory(caseId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.manifestSnapshot(caseId) })
      },
      meta: { action: 'sync now' }
    },
    setRelayUrl: {
      mutationFn: (relayUrl: string) => sharing((bridge) => bridge.setRelayUrl(relayUrl)),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
      meta: { action: 'save the relay URL' }
    },
    // A join makes a Case this window has never listed.
    join: {
      mutationFn: (invite: string) => sharing((bridge) => bridge.join(invite)),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.cases }),
      meta: { action: 'join the shared Case' }
    }
  }
}

export function useSharingMutations() {
  const queryClient = useQueryClient()
  const options = sharingMutationOptions(queryClient)
  return {
    createInvite: useMutation(options.createInvite),
    cancelInvite: useMutation(options.cancelInvite),
    approveJoin: useMutation(options.approveJoin),
    declineJoin: useMutation(options.declineJoin),
    revoke: useMutation(options.revoke),
    excludeExhibit: useMutation(options.excludeExhibit),
    syncNow: useMutation(options.syncNow),
    setRelayUrl: useMutation(options.setRelayUrl),
    join: useMutation(options.join)
  }
}
