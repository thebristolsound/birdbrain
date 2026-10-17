import type { RunParameters, RunProgressEvent, RunRequest, RunStatus } from '@shared/investigation'

// The engine behind the investigation channels (engine plan, E10). CI-R's run lifecycle drives a
// core through it, and the fake engine implements it until the real one replaces it.
export interface InvestigationEngine {
  run(
    request: RunRequest,
    options: {
      onProgress: (progress: RunProgressEvent) => void
      signal: AbortSignal
      parameters?: Partial<RunParameters> // the evaluation runner only; IPC never passes it
    }
  ): Promise<{ status: RunStatus; runId: string; reason: string | null }>
}
