// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import {
  previewForegroundMatches,
  useForegroundMatchPreview,
  type PreviewMatchesDeps
} from '@renderer/components/selectors/useForegroundMatchPreview'

interface Candidate {
  id: string
  title: string
  url: string
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function candidate(id: string, title = `Title ${id}`, url = `https://example.com/${id}`): Candidate {
  return { id, title, url }
}

function makeDeps(overrides: Partial<PreviewMatchesDeps> = {}): PreviewMatchesDeps {
  return {
    listCaptures: vi.fn(async () => [candidate('c1')]),
    getCaptureText: vi.fn(async () => 'no hits here'),
    listMatchingCaptureIds: vi.fn(async () => []),
    ...overrides
  }
}

const baseParams = {
  caseId: 'case-1',
  pattern: 'needle',
  isRegex: false,
  maxCaptures: 10,
  maxMatchesPerCapture: 50
}

describe('previewForegroundMatches', () => {
  it('assembles previews per matching capture, falling back to url when title is empty', async () => {
    const deps = makeDeps({
      listCaptures: vi.fn(async () => [
        candidate('c1'),
        { id: 'c2', title: '', url: 'https://example.com/c2' },
        candidate('c3')
      ]),
      getCaptureText: vi.fn(async (id: string) =>
        id === 'c3' ? 'nothing to see' : `one needle and another needle for ${id}`
      )
    })

    const results = await previewForegroundMatches(baseParams, deps)

    expect(results).toHaveLength(2)
    expect(results[0].captureTitle).toBe('Title c1')
    expect(results[0].matches).toHaveLength(2)
    expect(results[0].matches[0].matchText).toBe('needle')
    // Empty title falls back to the url; captures without matches are omitted.
    expect(results[1].captureTitle).toBe('https://example.com/c2')
    expect(results.map((r) => r.captureUrl)).toEqual([
      'https://example.com/c1',
      'https://example.com/c2'
    ])
  })

  it('tests at most maxCaptures candidates', async () => {
    const getCaptureText = vi.fn(async () => 'needle')
    const deps = makeDeps({
      listCaptures: vi.fn(async () => ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => candidate(id))),
      getCaptureText
    })

    const results = await previewForegroundMatches({ ...baseParams, maxCaptures: 2 }, deps)

    expect(getCaptureText).toHaveBeenCalledTimes(2)
    expect(results.map((r) => r.captureUrl)).toEqual([
      'https://example.com/c1',
      'https://example.com/c2'
    ])
  })

  it('caps matches per capture at maxMatchesPerCapture', async () => {
    const deps = makeDeps({
      getCaptureText: vi.fn(async () => 'needle needle needle needle needle')
    })

    const results = await previewForegroundMatches(
      { ...baseParams, maxMatchesPerCapture: 3 },
      deps
    )

    expect(results[0].matches).toHaveLength(3)
  })

  it('restricts candidates to the selector’s matching captures when selectorId is set', async () => {
    const listMatchingCaptureIds = vi.fn(async () => ['c2', 'c3'])
    const deps = makeDeps({
      listCaptures: vi.fn(async () => ['c1', 'c2', 'c3'].map((id) => candidate(id))),
      getCaptureText: vi.fn(async () => 'needle'),
      listMatchingCaptureIds
    })

    const results = await previewForegroundMatches(
      { ...baseParams, selectorId: 'sel-1' },
      deps
    )

    expect(listMatchingCaptureIds).toHaveBeenCalledWith('case-1', ['sel-1'])
    expect(results.map((r) => r.captureUrl)).toEqual([
      'https://example.com/c2',
      'https://example.com/c3'
    ])
  })

  it('does not ask for matching captures when selectorId is absent', async () => {
    const deps = makeDeps()

    await previewForegroundMatches(baseParams, deps)

    expect(deps.listMatchingCaptureIds).not.toHaveBeenCalled()
  })

  it('skips captures whose text fails to load or is empty, keeping the rest', async () => {
    const deps = makeDeps({
      listCaptures: vi.fn(async () => ['c1', 'c2', 'c3'].map((id) => candidate(id))),
      getCaptureText: vi.fn(async (id: string) => {
        if (id === 'c1') throw new Error('unreadable')
        if (id === 'c2') return null
        return 'needle'
      })
    })

    const results = await previewForegroundMatches(baseParams, deps)

    expect(results).toHaveLength(1)
    expect(results[0].captureUrl).toBe('https://example.com/c3')
  })
})

interface MockBirdbrain {
  captures: {
    list: (caseId: string) => Promise<Candidate[]>
    getContent: (captureId: string, type: string) => Promise<string | null>
  }
  selectors: {
    matchingCaptures: (caseId: string, selectorIds: string[]) => Promise<string[]>
  }
}

function setBirdbrain(overrides: Partial<MockBirdbrain> = {}) {
  const mock: MockBirdbrain = {
    captures: {
      list: vi.fn(async () => [candidate('c1')]),
      getContent: vi.fn(async () => 'one needle'),
      ...overrides.captures
    },
    selectors: {
      matchingCaptures: vi.fn(async () => ['c1']),
      ...overrides.selectors
    }
  }
  ;(window as unknown as { birdbrain: MockBirdbrain }).birdbrain = mock
  return mock
}

describe('useForegroundMatchPreview', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts with no previews and not loading', () => {
    setBirdbrain()
    const { result } = renderHook(() =>
      useForegroundMatchPreview('case-1', { maxCaptures: 10, maxMatchesPerCapture: 50 })
    )

    expect(result.current.previews).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('run() loads previews through the birdbrain bridge', async () => {
    const mock = setBirdbrain()
    const { result } = renderHook(() =>
      useForegroundMatchPreview('case-1', { maxCaptures: 10, maxMatchesPerCapture: 50 })
    )

    act(() => {
      void result.current.run('needle', false)
    })
    expect(result.current.loading).toBe(true)

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.previews).toHaveLength(1)
    expect(result.current.previews?.[0].matches[0].matchText).toBe('needle')
    expect(mock.captures.getContent).toHaveBeenCalledWith('c1', 'txt')
    expect(mock.selectors.matchingCaptures).not.toHaveBeenCalled()
  })

  it('run() with a selectorId restricts candidates to its matching captures', async () => {
    const mock = setBirdbrain({
      captures: {
        list: vi.fn(async () => [candidate('c1'), candidate('c2')]),
        getContent: vi.fn(async () => 'one needle')
      },
      selectors: { matchingCaptures: vi.fn(async () => ['c2']) }
    })
    const { result } = renderHook(() =>
      useForegroundMatchPreview('case-1', { maxCaptures: 3, maxMatchesPerCapture: 5 })
    )

    await act(async () => {
      await result.current.run('needle', false, 'sel-1')
    })

    expect(mock.selectors.matchingCaptures).toHaveBeenCalledWith('case-1', ['sel-1'])
    expect(result.current.previews).toHaveLength(1)
    expect(result.current.previews?.[0].captureUrl).toBe('https://example.com/c2')
  })

  it('run() clears previews and logs when the capture list cannot be fetched', async () => {
    setBirdbrain({
      captures: {
        list: vi.fn(async () => {
          throw new Error('ipc down')
        }),
        getContent: vi.fn(async () => 'one needle')
      }
    })
    const { result } = renderHook(() =>
      useForegroundMatchPreview('case-1', { maxCaptures: 10, maxMatchesPerCapture: 50 })
    )

    await act(async () => {
      await result.current.run('needle', false)
    })

    expect(result.current.previews).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(console.error).toHaveBeenCalledWith(
      'Failed to compute foreground match preview:',
      expect.any(Error)
    )
  })

  it('ignores a run that resolves after a newer run already committed', async () => {
    const first = deferred<Candidate[]>()
    setBirdbrain({
      captures: {
        list: vi
          .fn<(caseId: string) => Promise<Candidate[]>>()
          .mockReturnValueOnce(first.promise)
          .mockResolvedValueOnce([candidate('c2', 'Second', 'https://example.com/c2')]),
        getContent: vi.fn(async () => 'one needle')
      }
    })
    const { result } = renderHook(() =>
      useForegroundMatchPreview('case-1', { maxCaptures: 10, maxMatchesPerCapture: 50 })
    )

    act(() => {
      void result.current.run('needle', false)
    })
    await act(async () => {
      await result.current.run('needle', false)
    })
    expect(result.current.previews?.[0].captureUrl).toBe('https://example.com/c2')

    // The stale first run resolves last — it must not clobber the newer result.
    await act(async () => {
      first.resolve([candidate('c1', 'First', 'https://example.com/c1')])
      await first.promise
    })
    expect(result.current.previews?.[0].captureUrl).toBe('https://example.com/c2')
    expect(result.current.loading).toBe(false)
  })

  it('reset() discards an in-flight run', async () => {
    const pending = deferred<Candidate[]>()
    setBirdbrain({
      captures: {
        list: vi.fn(() => pending.promise),
        getContent: vi.fn(async () => 'one needle')
      }
    })
    const { result } = renderHook(() =>
      useForegroundMatchPreview('case-1', { maxCaptures: 10, maxMatchesPerCapture: 50 })
    )

    act(() => {
      void result.current.run('needle', false)
    })
    expect(result.current.loading).toBe(true)

    act(() => {
      result.current.reset()
    })
    expect(result.current.loading).toBe(false)

    await act(async () => {
      pending.resolve([candidate('c1')])
      await pending.promise
    })
    expect(result.current.previews).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('reset() returns previews to null', async () => {
    setBirdbrain()
    const { result } = renderHook(() =>
      useForegroundMatchPreview('case-1', { maxCaptures: 10, maxMatchesPerCapture: 50 })
    )

    await act(async () => {
      await result.current.run('needle', false)
    })
    expect(result.current.previews).not.toBeNull()

    act(() => {
      result.current.reset()
    })
    expect(result.current.previews).toBeNull()
  })
})
