// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { fakeBridge } from '../fakeBridge'
import {
  SYNC_STATE_POLL_MS,
  invitePreviewQueryOptions,
  membersQueryOptions,
  sharingAvailableQueryOptions,
  sharingErrorCode,
  refusalError,
  sharingMutationOptions,
  syncStateQueryOptions,
  useSharingMutations
} from '@renderer/lib/api/sharing'
import { queryKeys } from '@renderer/lib/api/keys'

afterEach(() => cleanup())

// The Shared Case query layer (#1514): each read calls its bridge method with
// the Case, the sync state polls, and each command refetches the keys the
// main process moved.

const refused = (code: string): Error => Object.assign(new Error(`refused: ${code}`), { code })

describe('sharing reads', () => {
  it('reads the roster and the sync state per Case, and polls the sync state', async () => {
    const getMembers = vi.fn(async () => ({ caseId: 'c1', members: [] }))
    const getSyncState = vi.fn(async () => ({ phase: 'idle' }))
    fakeBridge({ sharing: { getMembers, getSyncState } })

    const members = membersQueryOptions('c1')
    expect(members.queryKey).toEqual(queryKeys.sharingMembers('c1'))
    expect(members.enabled).toBe(true)
    await members.queryFn?.({} as never)
    expect(getMembers).toHaveBeenCalledWith('c1')
    expect(membersQueryOptions('').enabled).toBe(false)

    const sync = syncStateQueryOptions('c1')
    expect(sync.queryKey).toEqual(queryKeys.sharingSyncState('c1'))
    // 'syncing' is only observable by polling: onSharingChanged fires at the
    // end of a round, never at its start.
    expect(sync.refetchInterval).toBe(SYNC_STATE_POLL_MS)
    expect(SYNC_STATE_POLL_MS).toBe(5000)
    await sync.queryFn?.({} as never)
    expect(getSyncState).toHaveBeenCalledWith('c1')
    expect(syncStateQueryOptions('').enabled).toBe(false)
  })

  it('asks once whether sharing is available and reads an invite offline', async () => {
    const isAvailable = vi.fn(async () => false)
    const readInvite = vi.fn(async () => ({ caseId: 'c1', ownerName: 'A. Renner' }))
    fakeBridge({ sharing: { isAvailable, readInvite } })

    expect(sharingAvailableQueryOptions.queryKey).toEqual(queryKeys.sharingAvailable)
    expect(sharingAvailableQueryOptions.staleTime).toBe(Infinity)
    await expect(sharingAvailableQueryOptions.queryFn?.({} as never)).resolves.toBe(false)

    const preview = invitePreviewQueryOptions('bbinvite1abc')
    expect(preview.queryKey).toEqual(queryKeys.sharingInvitePreview('bbinvite1abc'))
    expect(preview.enabled).toBe(true)
    await preview.queryFn?.({} as never)
    expect(readInvite).toHaveBeenCalledWith('bbinvite1abc')
    expect(invitePreviewQueryOptions('').enabled).toBe(false)
  })
})

describe('sharingErrorCode', () => {
  it('reads a SharingErrorCode off `.code` and nothing else', () => {
    expect(sharingErrorCode(refused('invite-expired'))).toBe('invite-expired')
    expect(sharingErrorCode(refused('relay-unreachable'))).toBe('relay-unreachable')
    // A code main never issues is not a sharing refusal.
    expect(sharingErrorCode(refused('NOT_FOUND'))).toBeNull()
    expect(sharingErrorCode(Object.assign(new Error('x'), { code: 7 }))).toBeNull()
    expect(sharingErrorCode(new Error('disk full'))).toBeNull()
    expect(sharingErrorCode(null)).toBeNull()
    expect(sharingErrorCode('invite-expired')).toBeNull()
  })
})

describe('refusalError', () => {
  it('rebuilds the coded Error the preload sent across the bridge as a plain object', async () => {
    const createInvite = vi.fn(async () => {
      throw { message: 'Not a Birdbrain invite', code: 'invite-malformed' }
    })
    const readInvite = vi.fn(async () => {
      throw { message: 'declined', code: 'declined' }
    })
    fakeBridge({ sharing: { createInvite, readInvite } })

    const create = sharingMutationOptions(new QueryClient()).createInvite.mutationFn({
      caseId: 'c1'
    })
    await expect(create).rejects.toBeInstanceOf(Error)
    await expect(create).rejects.toMatchObject({
      message: 'Not a Birdbrain invite',
      code: 'invite-malformed'
    })
    const preview = invitePreviewQueryOptions('bbinvite1abc').queryFn?.({} as never)
    const rejection = await Promise.resolve(preview).catch((err: unknown) => err)
    expect(sharingErrorCode(rejection)).toBe('declined')
  })

  it('passes any other rejection through unchanged', () => {
    const error = refused('invite-expired')
    expect(refusalError(error)).toBe(error)
    const odd = { reason: 'no message' }
    expect(refusalError(odd)).toBe(odd)
    expect(refusalError('text')).toBe('text')
    expect(refusalError(null)).toBeNull()
    const uncoded = refusalError({ message: 'disk full' })
    expect(uncoded).toBeInstanceOf(Error)
    expect(uncoded).not.toHaveProperty('code')
  })
})

describe('sharing mutations', () => {
  function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    return { client, invalidate, options: sharingMutationOptions(client) }
  }

  const sharingKeys = (caseId: string) => [
    { queryKey: queryKeys.sharingMembers(caseId) },
    { queryKey: queryKeys.sharingSyncState(caseId) }
  ]

  it('createInvite shares the Case: roster, ledger and the Case list refetch', async () => {
    const createInvite = vi.fn(async () => ({ inviteId: 'i1', invite: 'bbinvite1x' }))
    fakeBridge({ sharing: { createInvite } })
    const { invalidate, options } = setup()
    const vars = { caseId: 'c1', ownerMemberCode: 'AR' }
    const data = await options.createInvite.mutationFn(vars)
    expect(createInvite).toHaveBeenCalledWith('c1', 'AR')
    options.createInvite.onSuccess(data, vars)
    for (const key of sharingKeys('c1')) expect(invalidate).toHaveBeenCalledWith(key)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.manifestSnapshot('c1') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.cases })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.case('c1') })
    expect(options.createInvite.meta.action).toBe('create an invite')
  })

  it('cancelInvite and declineJoin refetch the roster and sync state only', async () => {
    const cancelInvite = vi.fn(async () => undefined)
    const declineJoin = vi.fn(async () => undefined)
    fakeBridge({ sharing: { cancelInvite, declineJoin } })
    const { invalidate, options } = setup()

    await options.cancelInvite.mutationFn({ caseId: 'c1', inviteId: 'i1' })
    expect(cancelInvite).toHaveBeenCalledWith('c1', 'i1')
    options.cancelInvite.onSuccess(undefined, { caseId: 'c1' })
    await options.declineJoin.mutationFn({ caseId: 'c2', requestId: 'r1' })
    expect(declineJoin).toHaveBeenCalledWith('c2', 'r1')
    options.declineJoin.onSuccess(undefined, { caseId: 'c2' })

    for (const key of [...sharingKeys('c1'), ...sharingKeys('c2')]) {
      expect(invalidate).toHaveBeenCalledWith(key)
    }
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.manifestSnapshot('c1') })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.manifestSnapshot('c2') })
  })

  it('approveJoin, revoke and excludeExhibit write a chain entry, so the ledger refetches', async () => {
    const approveJoin = vi.fn(async () => ({ memberCode: 'JO' }))
    const revoke = vi.fn(async () => ({ memberCode: 'SI' }))
    const excludeExhibit = vi.fn(async () => ({ exhibitId: 'e1', index: 29 }))
    fakeBridge({ sharing: { approveJoin, revoke, excludeExhibit } })
    const { invalidate, options } = setup()

    const approved = { caseId: 'c1', requestId: 'r1', memberCode: 'JO' }
    options.approveJoin.onSuccess(await options.approveJoin.mutationFn(approved), approved)
    expect(approveJoin).toHaveBeenCalledWith('c1', 'r1', 'JO')

    const revoked = { caseId: 'c2', installationId: 'inst-si' }
    options.revoke.onSuccess(await options.revoke.mutationFn(revoked), revoked)
    expect(revoke).toHaveBeenCalledWith('c2', 'inst-si')

    const excluded = { caseId: 'c3', exhibitId: 'e1', reason: 'duplicate of NK-11' }
    options.excludeExhibit.onSuccess(await options.excludeExhibit.mutationFn(excluded), excluded)
    expect(excludeExhibit).toHaveBeenCalledWith('c3', 'e1', 'duplicate of NK-11')
    await options.excludeExhibit.mutationFn({ caseId: 'c3', exhibitId: 'e2' })
    expect(excludeExhibit).toHaveBeenLastCalledWith('c3', 'e2', undefined)

    for (const caseId of ['c1', 'c2', 'c3']) {
      for (const key of sharingKeys(caseId)) expect(invalidate).toHaveBeenCalledWith(key)
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.manifestSnapshot(caseId) })
    }
  })

  it('syncNow refetches what a round can bring; setRelayUrl and join refetch their readers', async () => {
    const syncNow = vi.fn(async () => [])
    const setRelayUrl = vi.fn(async () => undefined)
    const join = vi.fn(async () => ({ caseId: 'c9', caseName: 'Nightjar' }))
    fakeBridge({ sharing: { syncNow, setRelayUrl, join } })
    const { invalidate, options } = setup()

    options.syncNow.onSuccess(await options.syncNow.mutationFn('c1'), 'c1')
    expect(syncNow).toHaveBeenCalledWith('c1')
    for (const key of sharingKeys('c1')) expect(invalidate).toHaveBeenCalledWith(key)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.captures('c1') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.captureCounts })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.exhibitInventory('c1') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.manifestSnapshot('c1') })

    await options.setRelayUrl.mutationFn('https://relay.example.net')
    expect(setRelayUrl).toHaveBeenCalledWith('https://relay.example.net')
    options.setRelayUrl.onSuccess()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.settings })

    await options.join.mutationFn('bbinvite1x')
    expect(join).toHaveBeenCalledWith('bbinvite1x')
    options.join.onSuccess()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.cases })
  })

  it('useSharingMutations binds every command to the mounted client', async () => {
    const syncNow = vi.fn(async () => [])
    fakeBridge({ sharing: { syncNow } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children)

    const { result } = renderHook(() => useSharingMutations(), { wrapper })
    expect(Object.keys(result.current).sort()).toEqual(
      [
        'approveJoin',
        'cancelInvite',
        'createInvite',
        'declineJoin',
        'excludeExhibit',
        'join',
        'revoke',
        'setRelayUrl',
        'syncNow'
      ].sort()
    )
    result.current.syncNow.mutate('c1')
    await waitFor(() => expect(syncNow).toHaveBeenCalledWith('c1'))
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.sharingSyncState('c1') })
    )
  })
})
