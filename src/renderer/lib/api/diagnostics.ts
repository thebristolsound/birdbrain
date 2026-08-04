import { queryOptions } from '@tanstack/react-query'
import type { RendererLogPayload } from '@shared/ipc'
import type { BugReportInput, BugReportResult, LogEntry, SessionRecord } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'

// The diagnostics *components* migrate like any other feature code. The three
// lib-layer modules that also call this namespace — queryClient.ts,
// mainLogBridge.ts and notify.ts — stay on the bridge by design: they are the
// error-reporting path, and routing them through another indirection is what
// the design's lib-layer exemption exists to avoid.

// The panel polls, so the interval belongs to the call site rather than here —
// nothing else consuming this snapshot wants a 2s refetch.
export const diagnosticsQueryOptions = queryOptions({
  queryKey: queryKeys.diagnostics,
  queryFn: () => window.birdbrain.diagnostics.get()
})

export function logDiagnosticEvent(payload: RendererLogPayload): Promise<string> {
  return window.birdbrain.diagnostics.log(payload)
}

export function recentLogEntries(limit: number): Promise<LogEntry[]> {
  return window.birdbrain.diagnostics.recentEntries(limit)
}

export function revealLogFile(): Promise<void> {
  return window.birdbrain.diagnostics.revealLog()
}

// Take-once server-side: the first call after an unclean exit both returns and
// acknowledges the record.
export function lastSession(): Promise<SessionRecord | null> {
  return window.birdbrain.diagnostics.lastSession()
}

// Resolves null when the operator cancels the save-file dialog.
export function createBugReport(input: BugReportInput): Promise<BugReportResult | null> {
  return window.birdbrain.diagnostics.createReport(input)
}
