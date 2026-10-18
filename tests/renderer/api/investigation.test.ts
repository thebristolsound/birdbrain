// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { fakeBridge } from '../fakeBridge'
import {
  investigationChangesQueryOptions,
  investigationCheckQueryOptions,
  investigationRevisionQueryOptions,
  investigationSpanQueryOptions,
  investigationViewQueryOptions,
  ownIdentifiersQueryOptions,
  useInvestigationMutations
} from '@renderer/lib/api/investigation'
import { queryKeys } from '@renderer/lib/api/keys'
import { FIXTURE_POPULATED_VIEW } from '@shared/investigationFixture'
import type { CaseRevision } from '@shared/investigation'

afterEach(() => cleanup())

const REVISION: CaseRevision = { generation: 'g1', counter: 7, manifestHead: null }

describe('investigation query options', () => {
  it('read through the bridge, keyed per Case', async () => {
    const getRevision = vi.fn(async () => REVISION)
    const getView = vi.fn(async () => FIXTURE_POPULATED_VIEW)
    const getSpan = vi.fn(async () => null)
    const checkSpan = vi.fn(async () => null)
    const getChanges = vi.fn(async () => [])
    const listOwnIdentifiers = vi.fn(async () => [])
    fakeBridge({
      investigation: { getRevision, getView, getSpan, checkSpan, getChanges, listOwnIdentifiers }
    })

    const reads = [
      [
        investigationRevisionQueryOptions('c1'),
        queryKeys.investigationRevision('c1'),
        getRevision,
        ['c1']
      ],
      [investigationViewQueryOptions('c1'), queryKeys.investigationView('c1'), getView, ['c1']],
      [
        investigationSpanQueryOptions('c1', 's1'),
        queryKeys.investigationSpan('c1', 's1'),
        getSpan,
        ['c1', 's1']
      ],
      [
        investigationCheckQueryOptions('c1', 's1'),
        queryKeys.investigationCheck('c1', 's1'),
        checkSpan,
        ['c1', 's1']
      ],
      [
        investigationChangesQueryOptions('c1', 'r1'),
        queryKeys.investigationChanges('c1', 'r1'),
        getChanges,
        ['c1', 'r1']
      ],
      [ownIdentifiersQueryOptions('c1'), queryKeys.ownIdentifiers('c1'), listOwnIdentifiers, ['c1']]
    ] as const
    for (const [options, key, bridgeMethod, args] of reads) {
      expect(options.queryKey).toEqual(key)
      expect(options.enabled).toBe(true)
      await (options.queryFn as () => Promise<unknown>)()
      expect(bridgeMethod).toHaveBeenCalledWith(...args)
    }
  })

  it('are disabled without their ids', () => {
    expect(investigationRevisionQueryOptions('').enabled).toBe(false)
    expect(investigationViewQueryOptions('').enabled).toBe(false)
    expect(investigationSpanQueryOptions('c1', '').enabled).toBe(false)
    expect(investigationCheckQueryOptions('', 's1').enabled).toBe(false)
    expect(investigationChangesQueryOptions('c1', '').enabled).toBe(false)
    expect(ownIdentifiersQueryOptions('').enabled).toBe(false)
  })
})

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  const { result } = renderHook(() => useInvestigationMutations('c1'), { wrapper })
  return { client, result, invalidate }
}

describe('useInvestigationMutations', () => {
  it('starts and cancels a run for the hook’s Case, touching no cache', async () => {
    const startRun = vi.fn(async () => 'r1')
    const cancelRun = vi.fn(async () => undefined)
    fakeBridge({ investigation: { startRun, cancelRun } })
    const { result, invalidate } = setup()
    result.current.startRun.mutate({ from: 'find-more', jointId: 'j1' })
    await waitFor(() =>
      expect(startRun).toHaveBeenCalledWith({ caseId: 'c1', from: 'find-more', jointId: 'j1' })
    )
    result.current.cancelRun.mutate('r1')
    await waitFor(() => expect(cancelRun).toHaveBeenCalledWith('c1', 'r1'))
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('sends each write with the Case id, stores the revision and refreshes the Case’s reads', async () => {
    const write = () => vi.fn(async () => REVISION)
    const bridge = {
      decideJoint: write(),
      decideSpan: write(),
      chooseSubject: write(),
      addSubject: write(),
      keepSubject: write(),
      setSourceClass: write(),
      setCopyMark: write(),
      setWithheld: write(),
      markOwnIdentifier: write(),
      unmarkOwnIdentifier: write()
    }
    fakeBridge({ investigation: bridge })
    const { client, result, invalidate } = setup()
    const m = result.current
    const calls: [keyof typeof bridge, () => void, object][] = [
      [
        'decideJoint',
        () =>
          m.decideJoint.mutate({ jointId: 'j1', decision: 'reject', reason: null, context: null }),
        { jointId: 'j1' }
      ],
      [
        'decideSpan',
        () => m.decideSpan.mutate({ spanId: 's1', action: 'dismiss', reason: null }),
        { spanId: 's1' }
      ],
      [
        'chooseSubject',
        () => m.chooseSubject.mutate({ spanId: 's1', action: 'choose', subjectId: 'p1' }),
        { subjectId: 'p1' }
      ],
      [
        'addSubject',
        () => m.addSubject.mutate({ name: 'Marlow Star', kind: 'vessel' }),
        { name: 'Marlow Star' }
      ],
      ['keepSubject', () => m.keepSubject.mutate({ subjectId: 'p1' }), { subjectId: 'p1' }],
      [
        'setSourceClass',
        () => m.setSourceClass.mutate({ exhibitId: 'e1', value: 'original', reason: null }),
        { value: 'original' }
      ],
      [
        'setCopyMark',
        () => m.setCopyMark.mutate({ copyExhibitId: 'e1', originalExhibitId: 'e2', marked: true }),
        { marked: true }
      ],
      [
        'setWithheld',
        () => m.setWithheld.mutate({ exhibitId: 'e1', withheld: true }),
        { withheld: true }
      ],
      [
        'markOwnIdentifier',
        () =>
          m.markOwnIdentifier.mutate({
            kind: 'mail',
            platform: null,
            value: 'a@b.example.com',
            personaId: null
          }),
        { kind: 'mail' }
      ],
      [
        'unmarkOwnIdentifier',
        () => m.unmarkOwnIdentifier.mutate({ entryId: 'o1' }),
        { entryId: 'o1' }
      ]
    ]
    for (const [name, mutate, expected] of calls) {
      invalidate.mockClear()
      client.setQueryData(queryKeys.investigationRevision('c1'), undefined)
      mutate()
      await waitFor(() =>
        expect(bridge[name]).toHaveBeenCalledWith(
          expect.objectContaining({ caseId: 'c1', ...expected })
        )
      )
      await waitFor(() =>
        expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.investigationView('c1') })
      )
      expect(client.getQueryData(queryKeys.investigationRevision('c1'))).toEqual(REVISION)
      for (const key of [
        queryKeys.investigationSpans('c1'),
        queryKeys.investigationChangesAll('c1'),
        queryKeys.ownIdentifiers('c1')
      ]) {
        expect(invalidate).toHaveBeenCalledWith({ queryKey: key })
      }
    }
  })
})
