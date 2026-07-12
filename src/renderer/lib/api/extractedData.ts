import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@renderer/lib/api/keys'

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

export const extractedDataSearchQueryOptions = (caseId: string, query: string) =>
  queryOptions({
    queryKey: queryKeys.extractedDataSearch(caseId, query),
    queryFn: () => window.birdbrain.extractedData.search(caseId, query),
    enabled: !!caseId && query.trim().length > 0
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
