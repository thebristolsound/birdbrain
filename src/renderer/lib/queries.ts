import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  CreateCaseParams,
  UpdateCaseParams,
  CreateTagParams,
  UpdateTagParams,
  CreateSelectorParams,
  UpdateSelectorParams,
  CreateNoteParams,
  UpdateNoteParams,
  BulkCreateSelectorsParams,
  SaveAnnotationsParams,
  UpsertAnnotationPinParams
} from '@shared/ipc'
import type { BirdbrainSettings } from '@shared/types'

export const queryKeys = {
  cases: ['cases'] as const,
  case: (id: string) => ['cases', id] as const,
  captures: (caseId: string) => ['captures', caseId] as const,
  captureCounts: ['captureCounts'] as const,
  tags: ['tags'] as const,
  tagsForCapture: (captureId: string) => ['tags', 'capture', captureId] as const,
  tagCountForCase: (caseId: string) => ['tags', 'caseCount', caseId] as const,
  tagUsageCounts: (caseId: string) => ['tags', 'usageCounts', caseId] as const,
  selectors: (caseId: string) => ['selectors', caseId] as const,
  selectorMatchCounts: (caseId: string) => ['selectors', 'matchCounts', caseId] as const,
  selectorCoverage: (caseId: string) => ['selectors', 'coverage', caseId] as const,
  selectorMatchingCapturesAll: (caseId: string) =>
    ['selectors', 'matchingCaptures', caseId] as const,
  selectorMatchingCaptures: (caseId: string, selectorIds: string[]) =>
    ['selectors', 'matchingCaptures', caseId, ...selectorIds] as const,
  search: (query: string) => ['search', query] as const,
  notes: (caseId: string) => ['notes', caseId] as const,
  noteCount: (caseId: string) => ['notes', 'count', caseId] as const,
  notesSearch: (caseId: string, query: string) => ['notes', 'search', caseId, query] as const,
  extractedDataCategories: (caseId: string) => ['extractedData', 'categories', caseId] as const,
  extractedDataSubcategories: (caseId: string, category: string) =>
    ['extractedData', 'subcategories', caseId, category] as const,
  extractedDataItems: (caseId: string, category: string, subcategory: string) =>
    ['extractedData', 'items', caseId, category, subcategory] as const,
  extractedDataCount: (caseId: string) => ['extractedData', 'count', caseId] as const,
  annotations: (captureId: string) => ['annotations', captureId] as const,
  settings: ['settings'] as const
}

// --- Cases ---

export const casesQueryOptions = queryOptions({
  queryKey: queryKeys.cases,
  queryFn: () => window.birdbrain.cases.list()
})

export const caseQueryOptions = (id: string) =>
  queryOptions({
    queryKey: queryKeys.case(id),
    queryFn: () => window.birdbrain.cases.get(id)
  })

export function useCasesMutations() {
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: (params: CreateCaseParams) => window.birdbrain.cases.create(params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.cases })
  })

  const update = useMutation({
    mutationFn: (params: UpdateCaseParams) => window.birdbrain.cases.update(params),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cases })
      queryClient.invalidateQueries({ queryKey: queryKeys.case(vars.id) })
    }
  })

  const remove = useMutation({
    mutationFn: (id: string) => window.birdbrain.cases.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.cases })
  })

  return { create, update, remove }
}

// --- Captures ---

export const capturesQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.captures(caseId),
    queryFn: () => window.birdbrain.captures.list(caseId),
    enabled: !!caseId
  })

export const captureCountsQueryOptions = queryOptions({
  queryKey: queryKeys.captureCounts,
  queryFn: () => window.birdbrain.captures.countsByCase()
})

export function useCapturesMutations(caseId: string) {
  const queryClient = useQueryClient()

  const remove = useMutation({
    mutationFn: (id: string) => window.birdbrain.captures.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.captures(caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.captureCounts })
    }
  })

  return { remove }
}

// --- Tags ---

export const tagsQueryOptions = queryOptions({
  queryKey: queryKeys.tags,
  queryFn: () => window.birdbrain.tags.list()
})

export const tagsForCaptureQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.tagsForCapture(captureId),
    queryFn: () => window.birdbrain.tags.getForCapture(captureId),
    enabled: !!captureId
  })

export const tagCountForCaseQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.tagCountForCase(caseId),
    queryFn: () => window.birdbrain.tags.countForCase(caseId),
    enabled: !!caseId
  })

export const tagUsageCountsForCaseQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.tagUsageCounts(caseId),
    queryFn: () => window.birdbrain.tags.usageCountsForCase(caseId),
    enabled: !!caseId
  })

export function useTagsMutations() {
  const queryClient = useQueryClient()

  const invalidateTagCounts = () => {
    queryClient.invalidateQueries({ queryKey: ['tags', 'usageCounts'] })
    queryClient.invalidateQueries({ queryKey: ['tags', 'caseCount'] })
  }

  const create = useMutation({
    mutationFn: (params: CreateTagParams) => window.birdbrain.tags.create(params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tags })
  })

  const update = useMutation({
    mutationFn: (params: UpdateTagParams) => window.birdbrain.tags.update(params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tags })
  })

  const remove = useMutation({
    mutationFn: (id: string) => window.birdbrain.tags.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tags })
      invalidateTagCounts()
    }
  })

  const addToCapture = useMutation({
    mutationFn: ({ captureId, tagId }: { captureId: string; tagId: string }) =>
      window.birdbrain.tags.addToCapture({ captureId, tagId }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tagsForCapture(vars.captureId) })
      invalidateTagCounts()
    }
  })

  const removeFromCapture = useMutation({
    mutationFn: ({ captureId, tagId }: { captureId: string; tagId: string }) =>
      window.birdbrain.tags.removeFromCapture({ captureId, tagId }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tagsForCapture(vars.captureId) })
      invalidateTagCounts()
    }
  })

  return { create, update, remove, addToCapture, removeFromCapture }
}

// --- Selectors ---

export const selectorsQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.selectors(caseId),
    queryFn: () => window.birdbrain.selectors.list(caseId),
    enabled: !!caseId
  })

export const selectorMatchCountsQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.selectorMatchCounts(caseId),
    queryFn: () => window.birdbrain.selectors.matchCounts(caseId),
    enabled: !!caseId
  })

export const selectorCoverageQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.selectorCoverage(caseId),
    queryFn: () => window.birdbrain.selectors.coverage(caseId),
    enabled: !!caseId
  })

export function useSelectorsMutations(caseId: string) {
  const queryClient = useQueryClient()

  const invalidateSelectorQueries = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.selectors(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.selectorMatchCounts(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.selectorCoverage(caseId) })
  }

  const create = useMutation({
    mutationFn: (params: CreateSelectorParams) => window.birdbrain.selectors.create(params),
    onSuccess: invalidateSelectorQueries
  })

  const update = useMutation({
    mutationFn: (params: UpdateSelectorParams) => window.birdbrain.selectors.update(params),
    onSuccess: invalidateSelectorQueries
  })

  const remove = useMutation({
    mutationFn: (id: string) => window.birdbrain.selectors.delete(id),
    onSuccess: invalidateSelectorQueries
  })

  const bulkCreate = useMutation({
    mutationFn: (params: BulkCreateSelectorsParams) =>
      window.birdbrain.selectors.bulkCreate(params),
    onSuccess: invalidateSelectorQueries
  })

  return { create, update, remove, bulkCreate }
}

// --- Notes ---

export const notesQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.notes(caseId),
    queryFn: () => window.birdbrain.notes.list(caseId),
    enabled: !!caseId
  })

export const noteCountQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.noteCount(caseId),
    queryFn: () => window.birdbrain.notes.count(caseId),
    enabled: !!caseId
  })

export const notesSearchQueryOptions = (caseId: string, query: string) =>
  queryOptions({
    queryKey: queryKeys.notesSearch(caseId, query),
    queryFn: () => window.birdbrain.notes.search(caseId, query),
    enabled: !!caseId && query.trim().length > 0
  })

export function useNotesMutations(caseId: string) {
  const queryClient = useQueryClient()

  const invalidateNoteQueries = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.notes(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.noteCount(caseId) })
    queryClient.invalidateQueries({ queryKey: ['notes', 'search', caseId] })
  }

  const create = useMutation({
    mutationFn: (params: CreateNoteParams) => window.birdbrain.notes.create(params),
    onSuccess: invalidateNoteQueries
  })

  const update = useMutation({
    mutationFn: (params: UpdateNoteParams) => window.birdbrain.notes.update(params),
    onSuccess: invalidateNoteQueries
  })

  const remove = useMutation({
    mutationFn: (id: string) => window.birdbrain.notes.delete(id),
    onSuccess: invalidateNoteQueries
  })

  return { create, update, remove }
}

// --- Extracted Data ---

export const extractedDataCategoriesQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.extractedDataCategories(caseId),
    queryFn: () => window.birdbrain.extractedData.categories(caseId),
    enabled: !!caseId
  })

export const extractedDataSubcategoriesQueryOptions = (caseId: string, category: string) =>
  queryOptions({
    queryKey: queryKeys.extractedDataSubcategories(caseId, category),
    queryFn: () => window.birdbrain.extractedData.subcategories(caseId, category),
    enabled: !!caseId && !!category
  })

export const extractedDataItemsQueryOptions = (
  caseId: string,
  category: string,
  subcategory: string
) =>
  queryOptions({
    queryKey: queryKeys.extractedDataItems(caseId, category, subcategory),
    queryFn: () => window.birdbrain.extractedData.items(caseId, category, subcategory),
    enabled: !!caseId && !!category && !!subcategory
  })

export const extractedDataCountQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.extractedDataCount(caseId),
    queryFn: () => window.birdbrain.extractedData.count(caseId),
    enabled: !!caseId
  })

export function useExtractedDataMutations(caseId: string) {
  const queryClient = useQueryClient()

  const invalidateExtractedData = () => {
    queryClient.invalidateQueries({ queryKey: ['extractedData', 'categories', caseId] })
    queryClient.invalidateQueries({ queryKey: ['extractedData', 'count', caseId] })
    queryClient.invalidateQueries({ queryKey: ['extractedData', 'subcategories', caseId] })
    queryClient.invalidateQueries({ queryKey: ['extractedData', 'items', caseId] })
  }

  const reprocess = useMutation({
    mutationFn: () => window.birdbrain.extractedData.reprocess(caseId),
    onSuccess: invalidateExtractedData
  })

  return { reprocess }
}

// --- Annotations ---

export const annotationsQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.annotations(captureId),
    queryFn: () => window.birdbrain.annotations.get(captureId)
  })

export function useAnnotationsMutations(captureId: string) {
  const queryClient = useQueryClient()
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.annotations(captureId) })
  }

  const save = useMutation({
    mutationFn: (params: SaveAnnotationsParams) => window.birdbrain.annotations.save(params),
    onSuccess: invalidate
  })
  const upsertPin = useMutation({
    mutationFn: (params: UpsertAnnotationPinParams) =>
      window.birdbrain.annotations.upsertPin(params),
    onSuccess: invalidate
  })
  const deletePin = useMutation({
    mutationFn: (pinId: string) => window.birdbrain.annotations.deletePin(pinId),
    onSuccess: invalidate
  })
  const deleteAll = useMutation({
    mutationFn: (id: string) => window.birdbrain.annotations.delete(id),
    onSuccess: invalidate
  })

  return { save, upsertPin, deletePin, deleteAll }
}

// --- Settings ---

export const settingsQueryOptions = queryOptions({
  queryKey: queryKeys.settings,
  queryFn: () => window.birdbrain.settings.get()
})

export function useSettingsMutations() {
  const queryClient = useQueryClient()

  const update = useMutation({
    mutationFn: (partial: Partial<BirdbrainSettings>) => window.birdbrain.settings.update(partial),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings, data)
    }
  })

  return { update }
}
