import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { v4 as uuid } from 'uuid'
import type { CaptureAnalysis, TokenUsage } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'

export const analysisQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.analysis(captureId),
    queryFn: () => window.birdbrain.ai.getAnalysis(captureId),
    enabled: !!captureId
  })

export interface SaveAnalysisInput {
  content: string
  model: string
  tokenUsage: TokenUsage
}

export function useAnalysisMutations(captureId: string, caseId: string) {
  const queryClient = useQueryClient()

  const analyze = useMutation({
    mutationFn: async (model: string) => {
      const result = await window.birdbrain.ai.analyze({ captureId, caseId, model })
      return { ...result, completedAt: new Date().toISOString() }
    }
  })

  // saveAnalysis is upsert-by-captureId in the main process; id/timestamps are
  // minted here so callers only supply the analysis payload.
  const saveAnalysis = useMutation({
    mutationFn: async ({ content, model, tokenUsage }: SaveAnalysisInput) => {
      const existing = queryClient.getQueryData<CaptureAnalysis | null>(
        queryKeys.analysis(captureId)
      )
      const now = new Date().toISOString()
      const analysis: CaptureAnalysis = {
        id: existing?.id ?? uuid(),
        captureId,
        caseId,
        content,
        model,
        tokenUsage,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
      await window.birdbrain.ai.saveAnalysis(analysis)
      return analysis
    },
    onSuccess: (analysis) => {
      queryClient.setQueryData(queryKeys.analysis(captureId), analysis)
    }
  })

  return { analyze, saveAnalysis }
}
