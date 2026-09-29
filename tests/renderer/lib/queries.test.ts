// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  queryKeys,
  casesQueryOptions,
  caseQueryOptions,
  capturesQueryOptions,
  captureCountsQueryOptions,
  captureContentQueryOptions,
  captureThumbnailQueryOptions,
  captureMhtmlUrlQueryOptions,
  captureMatchingSelectorsQueryOptions,
  captureFavoritesQueryOptions,
  searchQueryOptions,
  tagsQueryOptions,
  tagsForCaptureQueryOptions,
  tagCountForCaseQueryOptions,
  tagUsageCountsForCaseQueryOptions,
  selectorsQueryOptions,
  selectorMatchCountsQueryOptions,
  selectorCoverageQueryOptions,
  notesQueryOptions,
  noteCountQueryOptions,
  notesSearchQueryOptions,
  noteReferenceEdgesQueryOptions,
  extractedDataCategoriesQueryOptions,
  extractedDataSubcategoriesQueryOptions,
  extractedDataItemsQueryOptions,
  extractedDataCountQueryOptions,
  extractedDataSearchQueryOptions,
  annotationsQueryOptions,
  settingsQueryOptions,
  identityQueryOptions,
  useCasesMutations,
  useCapturesMutations,
  useTagsMutations,
  useRecaptureMutations,
  useSelectorsMutations,
  useNotesMutations,
  useExtractedDataMutations,
  useAnnotationsMutations,
  useSettingsMutations
} from '@renderer/lib/queries'
import { fakeBridge } from '../fakeBridge'

// Build a fully-stubbed window.birdbrain whose every method records calls and
// resolves to a sentinel value, so queryFns/mutationFns can be exercised.
function installBirdbrainMock() {
  const fn = () => vi.fn().mockResolvedValue('ok')
  const api = {
    cases: {
      list: fn(),
      get: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
      getAutoCapturePolicy: fn(),
      setAutoCapturePolicy: fn()
    },
    captures: {
      list: fn(),
      countsByCase: fn(),
      getContent: fn(),
      getThumbnail: fn(),
      getMhtmlUrl: fn(),
      getMatchingSelectors: fn(),
      listFavorites: fn(),
      delete: fn(),
      toggleFavorite: fn(),
      deleteMany: vi.fn().mockResolvedValue({
        outcomes: [{ captureId: 'cap1', status: 'deleted' }],
        deletedIds: ['cap1'],
        failedIds: [],
        manifest: { baseIndex: 0, committedEntries: 1 }
      }),
      setFavoriteMany: vi.fn().mockResolvedValue({ affected: 2 })
    },
    recapture: { enqueue: fn(), queueStatus: fn(), enqueueCaptures: fn() },
    search: fn(),
    tags: {
      list: fn(),
      getForCapture: fn(),
      countForCase: fn(),
      usageCountsForCase: fn(),
      captureMatrix: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
      addToCapture: fn(),
      removeFromCapture: fn(),
      addToCaptures: vi.fn().mockResolvedValue({ affected: 2 })
    },
    selectors: {
      list: fn(),
      matchCounts: fn(),
      coverage: fn(),
      captureMatrix: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
      bulkCreate: fn()
    },
    notes: {
      list: fn(),
      count: fn(),
      search: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
      referenceEdges: fn()
    },
    extractedData: {
      categories: fn(),
      subcategories: fn(),
      items: fn(),
      count: fn(),
      search: fn(),
      reprocess: fn()
    },
    annotations: { get: fn(), save: fn(), upsertPin: fn(), deletePin: fn(), delete: fn() },
    settings: { get: fn(), update: fn(), getIdentity: fn() }
  }
  fakeBridge(api)
  return api
}

let api: ReturnType<typeof installBirdbrainMock>

beforeEach(() => {
  api = installBirdbrainMock()
})

describe('queryKeys', () => {
  it('produces stable, hierarchical keys', () => {
    expect(queryKeys.cases).toEqual(['cases'])
    expect(queryKeys.case('c1')).toEqual(['cases', 'c1'])
    expect(queryKeys.captures('c1')).toEqual(['captures', 'c1'])
    expect(queryKeys.captureContent('cap1', 'png')).toEqual(['captures', 'content', 'cap1', 'png'])
    expect(queryKeys.captureFavorites('c1')).toEqual(['captures', 'favorites', 'c1'])
    expect(queryKeys.search('c1', 'foo')).toEqual(['search', 'c1', 'foo'])
    expect(queryKeys.tagsForCapture('cap1')).toEqual(['tags', 'capture', 'cap1'])
    expect(queryKeys.selectorMatchCounts('c1')).toEqual(['selectors', 'matchCounts', 'c1'])
    expect(queryKeys.selectorMatchingCaptures('c1', ['s1', 's2'])).toEqual([
      'selectors',
      'matchingCaptures',
      'c1',
      's1',
      's2'
    ])
    expect(queryKeys.notesSearch('c1', 'q')).toEqual(['notes', 'search', 'c1', 'q'])
    expect(queryKeys.noteReferenceEdges('c1')).toEqual(['notes', 'referenceEdges', 'c1'])
    expect(queryKeys.extractedDataItems('c1', 'ioc', 'email')).toEqual([
      'extractedData',
      'items',
      'c1',
      'ioc',
      'email'
    ])
    expect(queryKeys.extractedDataSearch('c1', 'gmail')).toEqual([
      'extractedData',
      'search',
      'c1',
      'gmail'
    ])
    expect(queryKeys.annotations('cap1')).toEqual(['annotations', 'cap1'])
    expect(queryKeys.settings).toEqual(['settings'])
  })
})

describe('queryOptions queryFns', () => {
  it('wire each query option to the matching window.birdbrain method', async () => {
    await casesQueryOptions.queryFn?.({} as never)
    expect(api.cases.list).toHaveBeenCalled()

    expect(caseQueryOptions('c1').queryKey).toEqual(['cases', 'c1'])
    await caseQueryOptions('c1').queryFn?.({} as never)
    expect(api.cases.get).toHaveBeenCalledWith('c1')

    const capOpts = capturesQueryOptions('c1')
    expect(capOpts.enabled).toBe(true)
    await capOpts.queryFn?.({} as never)
    expect(api.captures.list).toHaveBeenCalledWith('c1')
    expect(capturesQueryOptions('').enabled).toBe(false)

    await captureCountsQueryOptions.queryFn?.({} as never)
    expect(api.captures.countsByCase).toHaveBeenCalled()

    await captureContentQueryOptions('cap1', 'html').queryFn?.({} as never)
    expect(api.captures.getContent).toHaveBeenCalledWith('cap1', 'html')

    await captureThumbnailQueryOptions('cap1').queryFn?.({} as never)
    expect(api.captures.getThumbnail).toHaveBeenCalledWith('cap1')

    await captureMhtmlUrlQueryOptions('cap1').queryFn?.({} as never)
    expect(api.captures.getMhtmlUrl).toHaveBeenCalledWith('cap1')

    await captureMatchingSelectorsQueryOptions('cap1').queryFn?.({} as never)
    expect(api.captures.getMatchingSelectors).toHaveBeenCalledWith('cap1')

    await captureFavoritesQueryOptions('c1').queryFn?.({} as never)
    expect(api.captures.listFavorites).toHaveBeenCalledWith('c1')

    const searchOpts = searchQueryOptions('c1', 'foo')
    expect(searchOpts.enabled).toBe(true)
    await searchOpts.queryFn?.({} as never)
    expect(api.search).toHaveBeenCalledWith('c1', 'foo')
    expect(searchQueryOptions('c1', '   ').enabled).toBe(false)
    expect(searchQueryOptions('', 'foo').enabled).toBe(false)

    await tagsQueryOptions.queryFn?.({} as never)
    expect(api.tags.list).toHaveBeenCalled()
    await tagsForCaptureQueryOptions('cap1').queryFn?.({} as never)
    expect(api.tags.getForCapture).toHaveBeenCalledWith('cap1')
    await tagCountForCaseQueryOptions('c1').queryFn?.({} as never)
    expect(api.tags.countForCase).toHaveBeenCalledWith('c1')
    await tagUsageCountsForCaseQueryOptions('c1').queryFn?.({} as never)
    expect(api.tags.usageCountsForCase).toHaveBeenCalledWith('c1')

    await selectorsQueryOptions('c1').queryFn?.({} as never)
    expect(api.selectors.list).toHaveBeenCalledWith('c1')
    await selectorMatchCountsQueryOptions('c1').queryFn?.({} as never)
    expect(api.selectors.matchCounts).toHaveBeenCalledWith('c1')
    await selectorCoverageQueryOptions('c1').queryFn?.({} as never)
    expect(api.selectors.coverage).toHaveBeenCalledWith('c1')

    await notesQueryOptions('c1').queryFn?.({} as never)
    expect(api.notes.list).toHaveBeenCalledWith('c1')
    await noteCountQueryOptions('c1').queryFn?.({} as never)
    expect(api.notes.count).toHaveBeenCalledWith('c1')
    const notesSearch = notesSearchQueryOptions('c1', 'q')
    expect(notesSearch.enabled).toBe(true)
    await notesSearch.queryFn?.({} as never)
    expect(api.notes.search).toHaveBeenCalledWith('c1', 'q')
    expect(notesSearchQueryOptions('c1', '  ').enabled).toBe(false)
    await noteReferenceEdgesQueryOptions('c1').queryFn?.({} as never)
    expect(api.notes.referenceEdges).toHaveBeenCalledWith('c1')
    expect(noteReferenceEdgesQueryOptions('').enabled).toBe(false)

    await extractedDataCategoriesQueryOptions('c1').queryFn?.({} as never)
    expect(api.extractedData.categories).toHaveBeenCalledWith('c1')
    await extractedDataSubcategoriesQueryOptions('c1', 'ioc').queryFn?.({} as never)
    expect(api.extractedData.subcategories).toHaveBeenCalledWith('c1', 'ioc')
    await extractedDataItemsQueryOptions('c1', 'ioc', 'email').queryFn?.({} as never)
    expect(api.extractedData.items).toHaveBeenCalledWith('c1', 'ioc', 'email')
    await extractedDataCountQueryOptions('c1').queryFn?.({} as never)
    expect(api.extractedData.count).toHaveBeenCalledWith('c1')
    expect(extractedDataSubcategoriesQueryOptions('c1', '').enabled).toBe(false)
    expect(extractedDataItemsQueryOptions('c1', 'ioc', '').enabled).toBe(false)
    await extractedDataSearchQueryOptions('c1', 'gmail').queryFn?.({} as never)
    expect(api.extractedData.search).toHaveBeenCalledWith('c1', 'gmail')
    expect(extractedDataSearchQueryOptions('c1', '  ').enabled).toBe(false)

    await annotationsQueryOptions('cap1').queryFn?.({} as never)
    expect(api.annotations.get).toHaveBeenCalledWith('cap1')

    await settingsQueryOptions.queryFn?.({} as never)
    expect(api.settings.get).toHaveBeenCalled()
    await identityQueryOptions.queryFn?.({} as never)
    expect(api.settings.getIdentity).toHaveBeenCalled()
  })
})

// --- Mutation hooks: assert cache invalidation behaviour --------------------

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue()
  const setQueryData = vi.spyOn(client, 'setQueryData')
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  return { client, invalidate, setQueryData, wrapper }
}

function invalidatedKeys(spy: { mock: { calls: readonly unknown[][] } }) {
  return spy.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey)
}

describe('useCasesMutations', () => {
  it('invalidates case lists on create/update/remove', async () => {
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useCasesMutations(), { wrapper })

    await act(async () => {
      await result.current.create.mutateAsync({ name: 'X' })
    })
    expect(api.cases.create).toHaveBeenCalled()
    expect(invalidatedKeys(invalidate)).toContainEqual(['cases'])

    invalidate.mockClear()
    await act(async () => {
      await result.current.update.mutateAsync({ id: 'c1', name: 'Y' })
    })
    expect(invalidatedKeys(invalidate)).toContainEqual(['cases'])
    expect(invalidatedKeys(invalidate)).toContainEqual(['cases', 'c1'])

    invalidate.mockClear()
    await act(async () => {
      await result.current.remove.mutateAsync('c1')
    })
    expect(invalidatedKeys(invalidate)).toContainEqual(['cases'])
  })
})

describe('useCapturesMutations', () => {
  it('invalidates captures + counts on remove and favorites on toggle', async () => {
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useCapturesMutations('c1'), { wrapper })

    await act(async () => {
      await result.current.remove.mutateAsync('cap1')
    })
    expect(invalidatedKeys(invalidate)).toContainEqual(['captures', 'c1'])
    expect(invalidatedKeys(invalidate)).toContainEqual(['captureCounts'])

    invalidate.mockClear()
    await act(async () => {
      await result.current.toggleFavorite.mutateAsync('cap1')
    })
    expect(invalidatedKeys(invalidate)).toContainEqual(['captures', 'favorites', 'c1'])
    expect(invalidatedKeys(invalidate)).toContainEqual(['captures', 'c1'])
  })
})

describe('useCapturesMutations batch hooks (#394)', () => {
  it('removeMany invalidates captures, counts and favorites when something was deleted', async () => {
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useCapturesMutations('c1'), { wrapper })

    await act(async () => {
      await result.current.removeMany.mutateAsync(['cap1', 'cap2'])
    })
    expect(api.captures.deleteMany).toHaveBeenCalledWith({
      caseId: 'c1',
      captureIds: ['cap1', 'cap2']
    })
    const keys = invalidatedKeys(invalidate)
    expect(keys).toContainEqual(['captures', 'c1'])
    expect(keys).toContainEqual(['captureCounts'])
    expect(keys).toContainEqual(['captures', 'favorites', 'c1'])
  })

  it('removeMany still invalidates when every id was not_found: the cache showed rows already gone', async () => {
    api.captures.deleteMany.mockResolvedValue({
      outcomes: [{ captureId: 'ghost', status: 'rejected', reason: 'not_found' }],
      deletedIds: [],
      failedIds: [],
      manifest: { baseIndex: 0, committedEntries: 0 }
    })
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useCapturesMutations('c1'), { wrapper })

    await act(async () => {
      await result.current.removeMany.mutateAsync(['ghost'])
    })
    expect(invalidatedKeys(invalidate)).toContainEqual(['captures', 'c1'])
  })

  it('removeMany invalidates nothing when the batch deleted nothing and saw no stale ids', async () => {
    api.captures.deleteMany.mockResolvedValue({
      outcomes: [
        { captureId: 'cap1', status: 'rolled_back', stage: 'artifacts', error: 'Error (EBUSY)' },
        { captureId: 'cap1', status: 'rejected', reason: 'duplicate' }
      ],
      deletedIds: [],
      failedIds: ['cap1'],
      haltedAt: 'cap1',
      manifest: { baseIndex: 0, committedEntries: 0 }
    })
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useCapturesMutations('c1'), { wrapper })

    await act(async () => {
      await result.current.removeMany.mutateAsync(['cap1', 'cap1'])
    })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('setFavoriteMany invalidates favorites and captures', async () => {
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useCapturesMutations('c1'), { wrapper })

    await act(async () => {
      await result.current.setFavoriteMany.mutateAsync({ captureIds: ['cap1'], favorite: true })
    })
    expect(api.captures.setFavoriteMany).toHaveBeenCalledWith({
      caseId: 'c1',
      captureIds: ['cap1'],
      favorite: true
    })
    expect(invalidatedKeys(invalidate)).toContainEqual(['captures', 'favorites', 'c1'])
    expect(invalidatedKeys(invalidate)).toContainEqual(['captures', 'c1'])
  })
})

describe('useTagsMutations.addToCaptures (#394)', () => {
  it('invalidates each capture tag list and the tag counts', async () => {
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useTagsMutations('c1'), { wrapper })

    await act(async () => {
      await result.current.addToCaptures.mutateAsync({ captureIds: ['cap1', 'cap2'], tagId: 't1' })
    })
    expect(api.tags.addToCaptures).toHaveBeenCalledWith({
      caseId: 'c1',
      captureIds: ['cap1', 'cap2'],
      tagId: 't1'
    })
    const keys = invalidatedKeys(invalidate)
    expect(keys).toContainEqual(['tags', 'capture', 'cap1'])
    expect(keys).toContainEqual(['tags', 'capture', 'cap2'])
    expect(keys).toContainEqual(['tags', 'usageCounts'])
    expect(keys).toContainEqual(['tags', 'caseCount'])
  })

  it('rejects without a caseId instead of sending an unguarded batch', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useTagsMutations(), { wrapper })
    await expect(
      result.current.addToCaptures.mutateAsync({ captureIds: ['cap1'], tagId: 't1' })
    ).rejects.toThrow('caseId')
    expect(api.tags.addToCaptures).not.toHaveBeenCalled()
  })
})

describe('useRecaptureMutations.enqueueCaptures (#394)', () => {
  it('sends the case-scoped batch and invalidates the queue', async () => {
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useRecaptureMutations('c1'), { wrapper })

    await act(async () => {
      await result.current.enqueueCaptures.mutateAsync(['cap1', 'cap2'])
    })
    expect(api.recapture.enqueueCaptures).toHaveBeenCalledWith({
      caseId: 'c1',
      captureIds: ['cap1', 'cap2']
    })
    expect(invalidatedKeys(invalidate)).toContainEqual(['recaptureQueue'])
  })
})

describe('useTagsMutations', () => {
  it('invalidates tags and tag counts across operations', async () => {
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useTagsMutations(), { wrapper })

    await act(async () => {
      await result.current.create.mutateAsync({ name: 't', color: '#fff' })
    })
    expect(invalidatedKeys(invalidate)).toContainEqual(['tags'])

    invalidate.mockClear()
    await act(async () => {
      await result.current.remove.mutateAsync('t1')
    })
    const keys = invalidatedKeys(invalidate)
    expect(keys).toContainEqual(['tags'])
    expect(keys).toContainEqual(['tags', 'usageCounts'])
    expect(keys).toContainEqual(['tags', 'caseCount'])

    invalidate.mockClear()
    await act(async () => {
      await result.current.addToCapture.mutateAsync({ captureId: 'cap1', tagId: 't1' })
    })
    expect(invalidatedKeys(invalidate)).toContainEqual(['tags', 'capture', 'cap1'])

    invalidate.mockClear()
    await act(async () => {
      await result.current.removeFromCapture.mutateAsync({ captureId: 'cap1', tagId: 't1' })
    })
    expect(invalidatedKeys(invalidate)).toContainEqual(['tags', 'capture', 'cap1'])

    invalidate.mockClear()
    await act(async () => {
      await result.current.update.mutateAsync({ id: 't1', name: 'n', color: '#000' })
    })
    expect(invalidatedKeys(invalidate)).toContainEqual(['tags'])
  })
})

describe('useSelectorsMutations', () => {
  it('invalidates selector list, match counts and coverage on every op', async () => {
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useSelectorsMutations('c1'), { wrapper })

    for (const run of [
      () => result.current.create.mutateAsync({ caseId: 'c1', pattern: 'p', isRegex: false }),
      () => result.current.update.mutateAsync({ id: 's1', pattern: 'p', isRegex: false }),
      () => result.current.remove.mutateAsync('s1'),
      () => result.current.bulkCreate.mutateAsync({ caseId: 'c1', selectors: [] })
    ]) {
      invalidate.mockClear()
      await act(async () => {
        await run()
      })
      const keys = invalidatedKeys(invalidate)
      expect(keys).toContainEqual(['selectors', 'c1'])
      expect(keys).toContainEqual(['selectors', 'matchCounts', 'c1'])
      expect(keys).toContainEqual(['selectors', 'coverage', 'c1'])
    }
  })
})

describe('useNotesMutations', () => {
  // The reference-edges key is asserted explicitly because ['notes', caseId]
  // does not prefix-match ['notes', 'referenceEdges', caseId]: without its own
  // invalidation line the Overview map would survive every note write (#402).
  it('invalidates notes, count, search and reference edges on create/update/remove', async () => {
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useNotesMutations('c1'), { wrapper })

    for (const run of [
      () => result.current.create.mutateAsync({ caseId: 'c1', body: 'x' }),
      () => result.current.update.mutateAsync({ id: 'n1', body: 'y' }),
      () => result.current.remove.mutateAsync('n1')
    ]) {
      invalidate.mockClear()
      await act(async () => {
        await run()
      })
      const keys = invalidatedKeys(invalidate)
      expect(keys).toContainEqual(['notes', 'c1'])
      expect(keys).toContainEqual(['notes', 'count', 'c1'])
      expect(keys).toContainEqual(['notes', 'search', 'c1'])
      expect(keys).toContainEqual(['notes', 'referenceEdges', 'c1'])
    }
  })
})

describe('useExtractedDataMutations', () => {
  it('invalidates all extracted-data queries on reprocess', async () => {
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useExtractedDataMutations('c1'), { wrapper })

    await act(async () => {
      await result.current.reprocess.mutateAsync()
    })
    const keys = invalidatedKeys(invalidate)
    expect(keys).toContainEqual(['extractedData', 'categories', 'c1'])
    expect(keys).toContainEqual(['extractedData', 'count', 'c1'])
    expect(keys).toContainEqual(['extractedData', 'subcategories', 'c1'])
    expect(keys).toContainEqual(['extractedData', 'items', 'c1'])
  })
})

describe('useAnnotationsMutations', () => {
  it('invalidates the capture annotations on save/pin/delete', async () => {
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useAnnotationsMutations('cap1'), { wrapper })

    for (const run of [
      () =>
        result.current.save.mutateAsync({
          captureId: 'cap1',
          shapes: [],
          imageWidth: 1,
          imageHeight: 1
        }),
      () => result.current.upsertPin.mutateAsync({ captureId: 'cap1', body: 'b' }),
      () => result.current.deletePin.mutateAsync('pin1'),
      () => result.current.deleteAll.mutateAsync('cap1')
    ]) {
      invalidate.mockClear()
      await act(async () => {
        await run()
      })
      expect(invalidatedKeys(invalidate)).toContainEqual(['annotations', 'cap1'])
    }
  })
})

describe('useSettingsMutations', () => {
  it('writes the settings cache without invalidating anything', async () => {
    const { invalidate, setQueryData, wrapper } = setup()
    api.settings.update.mockResolvedValue({ operatorName: 'A' })
    const { result } = renderHook(() => useSettingsMutations(), { wrapper })

    await act(async () => {
      await result.current.update.mutateAsync({ operatorName: 'A' })
    })
    expect(setQueryData).toHaveBeenCalledWith(['settings'], { operatorName: 'A' })
    expect(invalidate).not.toHaveBeenCalled()
  })
})
