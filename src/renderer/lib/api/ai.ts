import { queryOptions } from '@tanstack/react-query'
import type { AnalyzeCaptureParams } from '@shared/ipc'
import type { CaptureAnalysis, TokenUsage } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'

export const captureAnalysisQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.captureAnalysis(captureId),
    queryFn: () => window.birdbrain.ai.getAnalysis(captureId),
    enabled: !!captureId
  })

// analyze/saveAnalysis land as plain wrappers rather than the mutation-options
// factories the design prescribes for rendered writes. AnalysisTab drives both
// from its own useMutation with local onSuccess handlers, and moving that
// wiring behind a factory is the AnalysisTab restructure — a behaviour change
// that the design keeps out of the mechanical move. Tracked in #346.

export function analyzeCapture(
  params: AnalyzeCaptureParams
): Promise<{ content: string; tokenUsage: TokenUsage }> {
  return window.birdbrain.ai.analyze(params)
}

export function saveCaptureAnalysis(analysis: CaptureAnalysis): Promise<void> {
  return window.birdbrain.ai.saveAnalysis(analysis)
}
