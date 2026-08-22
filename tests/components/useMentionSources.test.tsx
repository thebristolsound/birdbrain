// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture, Tag } from '@shared/types'
import {
  useMentionResolver,
  useMentionSources,
  type MentionResolver,
  type UseMentionSourcesResult
} from '@renderer/components/notes/mention/useMentionSources'
import { rankMentionCandidates } from '@renderer/components/notes/mention/mentionModel'
import { fakeBridge } from '../renderer/fakeBridge'

const capture: Capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/thread',
  title: 'Nightjar thread',
  hash: 'h',
  timestamp: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-08-01T00:00:00.000Z',
  format: 'mhtml',
  method: 'extension'
}

const tag: Tag = { id: 't1', name: 'suspect', color: '#22c55e' }

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

let latest: UseMentionSourcesResult | null = null
let resolver: MentionResolver | null = null

function Probe() {
  latest = useMentionSources('case1')
  resolver = useMentionResolver('case1')
  return null
}

beforeEach(() => {
  latest = null
  resolver = null
  fakeBridge({
    captures: { list: vi.fn(async () => [capture]) },
    notes: { list: vi.fn(async () => []) },
    selectors: { list: vi.fn(async () => []), matchCounts: vi.fn(async () => ({ s1: 3 })) },
    tags: { list: vi.fn(async () => [tag]), usageCountsForCase: vi.fn(async () => ({ t1: 2 })) }
  })
})

afterEach(cleanup)

describe('useMentionSources', () => {
  it('starts with nothing loaded, so no chip can be called broken yet', () => {
    render(<Probe />, { wrapper: Wrapper })

    expect(latest!.loaded).toEqual({
      capture: false,
      note: false,
      selector: false,
      tag: false
    })
    expect(resolver!('capture', 'cap1').status).toBe('loading')
  })

  it('gathers all six list queries into one shape the ranker reads', async () => {
    render(<Probe />, { wrapper: Wrapper })

    await waitFor(() => expect(latest!.loaded.capture).toBe(true))
    await waitFor(() => expect(latest!.loaded.tag).toBe(true))

    expect(latest!.sources.captures).toEqual([capture])
    expect(latest!.sources.tags).toEqual([tag])
    expect(latest!.sources.tagUsage).toEqual({ t1: 2 })
    expect(latest!.sources.selectorMatchCounts).toEqual({ s1: 3 })
  })

  it('keeps the ref current, which is what the once-built plugin closure reads', async () => {
    render(<Probe />, { wrapper: Wrapper })

    await waitFor(() => expect(latest!.ref.current.captures).toHaveLength(1))

    // The suggestion plugin's items() closure is created at editor
    // construction and never rebuilt; through the ref it still sees this.
    const rows = rankMentionCandidates({
      sigil: '@',
      query: 'nightjar',
      sources: latest!.ref.current
    })
    expect(rows.map((r) => r.targetId)).toEqual(['cap1'])
  })

  it('resolves a live target and reports a deleted one as missing', async () => {
    render(<Probe />, { wrapper: Wrapper })

    await waitFor(() => expect(resolver!('capture', 'cap1').status).toBe('resolved'))

    expect(resolver!('capture', 'cap1').label).toBe('Nightjar thread')
    expect(resolver!('capture', 'gone').status).toBe('missing')
    expect(resolver!('tag', 't1')).toEqual({
      status: 'resolved',
      label: 'suspect',
      color: '#22c55e'
    })
  })
})
