import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { v4 as uuid } from 'uuid'
import type { AnalyzeCaptureParams } from '@shared/ipc'
import type { CaptureAnalysis, TokenUsage } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'

export const captureAnalysisQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.captureAnalysis(captureId),
    queryFn: () => window.birdbrain.ai.getAnalysis({ captureId }),
    enabled: !!captureId
  })

/**
 * One completed analysis run: the model's output, the model that produced it,
 * and the moment it landed.
 *
 * `analyzedAt` is display-only. `CaptureAnalysis` has no field for it, and
 * `saveAnalysis` stamps its own `createdAt`/`updatedAt` at write time, so the
 * run's timestamp never reaches the row — the tab shows it only while the run
 * is still unsaved.
 */
export interface AnalysisRun {
  content: string
  model: string
  tokenUsage: TokenUsage
  analyzedAt: string
}

export interface SaveAnalysisInput {
  captureId: string
  caseId: string
  content: string
  model: string
  tokenUsage: TokenUsage
  /**
   * The row already on disk, when there is one. `ai:saveAnalysis` upserts by
   * captureId, so a re-save has to carry the original id and createdAt forward
   * rather than mint a second identity for a row that is being replaced.
   */
  existing?: CaptureAnalysis | null
}

export function aiMutationOptions(queryClient: QueryClient) {
  return {
    // No cache write: an analysis run is not persisted until the operator
    // saves it, so nothing under captureAnalysis has moved yet.
    analyze: {
      mutationFn: async (params: AnalyzeCaptureParams): Promise<AnalysisRun> => {
        const { content, tokenUsage } = await window.birdbrain.ai.analyze(params)
        // The model travels with the run because the picker can move between
        // analysing and saving. The row records what produced the findings,
        // not what happened to be selected when Save was pressed.
        return {
          content,
          model: params.model,
          tokenUsage,
          analyzedAt: new Date().toISOString()
        }
      },
      meta: { action: 'analyze the capture' }
    },
    saveAnalysis: {
      mutationFn: async (input: SaveAnalysisInput): Promise<CaptureAnalysis> => {
        const now = new Date().toISOString()
        const analysis: CaptureAnalysis = {
          id: input.existing?.id ?? uuid(),
          captureId: input.captureId,
          caseId: input.caseId,
          content: input.content,
          model: input.model,
          tokenUsage: input.tokenUsage,
          createdAt: input.existing?.createdAt ?? now,
          updatedAt: now
        }
        await window.birdbrain.ai.saveAnalysis(analysis)
        return analysis
      },
      // Write-through then invalidate. The write-through is what lets the tab
      // stop tracking "unsaved" by hand — the row it just sent is the row the
      // cache holds. The invalidation still fires, so if main stored anything
      // other than what was sent, the refetch corrects it rather than leaving
      // the optimistic copy standing.
      onSuccess: (analysis: CaptureAnalysis) => {
        const key = queryKeys.captureAnalysis(analysis.captureId)
        queryClient.setQueryData(key, analysis)
        queryClient.invalidateQueries({ queryKey: key })
      },
      meta: { action: 'save the analysis' }
    }
  }
}

export function useAiMutations() {
  const queryClient = useQueryClient()
  const opts = aiMutationOptions(queryClient)
  return {
    analyze: useMutation(opts.analyze),
    saveAnalysis: useMutation(opts.saveAnalysis)
  }
}
