import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { CreateCaseParams, UpdateCaseParams, CreateTagParams, UpdateTagParams, CreateSelectorParams, UpdateSelectorParams } from '@shared/ipc'

export const queryKeys = {
  cases: ['cases'] as const,
  case: (id: string) => ['cases', id] as const,
  captures: (caseId: string) => ['captures', caseId] as const,
  captureCounts: ['captureCounts'] as const,
  tags: ['tags'] as const,
  tagsForCapture: (captureId: string) => ['tags', 'capture', captureId] as const,
  tagCountForCase: (caseId: string) => ['tags', 'caseCount', caseId] as const,
  selectors: (caseId: string) => ['selectors', caseId] as const,
  selectorMatchCounts: (caseId: string) => ['selectors', 'matchCounts', caseId] as const,
  selectorCoverage: (caseId: string) => ['selectors', 'coverage', caseId] as const,
  selectorMatchingCaptures: (caseId: string, selectorIds: string[]) =>
    ['selectors', 'matchingCaptures', caseId, ...selectorIds] as const,
  search: (query: string) => ['search', query] as const
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

export function useTagsMutations() {
  const queryClient = useQueryClient()

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tags })
  })

  const addToCapture = useMutation({
    mutationFn: ({ captureId, tagId }: { captureId: string; tagId: string }) =>
      window.birdbrain.tags.addToCapture({ captureId, tagId }),
    onSuccess: (_data, vars) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.tagsForCapture(vars.captureId) })
  })

  const removeFromCapture = useMutation({
    mutationFn: ({ captureId, tagId }: { captureId: string; tagId: string }) =>
      window.birdbrain.tags.removeFromCapture({ captureId, tagId }),
    onSuccess: (_data, vars) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.tagsForCapture(vars.captureId) })
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

  const create = useMutation({
    mutationFn: (params: CreateSelectorParams) => window.birdbrain.selectors.create(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.selectors(caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.selectorMatchCounts(caseId) })
    }
  })

  const update = useMutation({
    mutationFn: (params: UpdateSelectorParams) => window.birdbrain.selectors.update(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.selectors(caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.selectorMatchCounts(caseId) })
    }
  })

  const remove = useMutation({
    mutationFn: (id: string) => window.birdbrain.selectors.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.selectors(caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.selectorMatchCounts(caseId) })
    }
  })

  return { create, update, remove }
}
