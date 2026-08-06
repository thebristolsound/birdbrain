import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useQuery } from '@tanstack/react-query'
import Markdown from 'react-markdown'
import type { ExtraProps } from 'react-markdown'
import { Button } from '@renderer/components/ui'
import { Loader2, Save, RefreshCw, StickyNote, Settings, Sparkles, Copy } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useOpenRouterModels } from '@renderer/hooks/useOpenRouterModels'
import { presets } from '@renderer/lib/motion'
import { settingsQueryOptions } from '@renderer/lib/api/settings'
import { openCaptureExternal } from '@renderer/lib/api/system'
import { captureAnalysisQueryOptions, useAiMutations } from '@renderer/lib/api/ai'
import type { AnalysisRun } from '@renderer/lib/api/ai'
import type { CaptureAnalysis } from '@shared/types'

interface AnalysisTabProps {
  captureId: string
  caseId: string
  captureTitle: string
  onOpenNote: (prefillTitle: string, prefillBody: string) => void
}

// Every field the save writes, not just the content. A re-run under a different
// model can return byte-identical text, and comparing content alone would call
// that run saved while the row still credits the previous model.
function runIsStored(run: AnalysisRun, stored: CaptureAnalysis | null | undefined): boolean {
  return (
    !!stored &&
    run.content === stored.content &&
    run.model === stored.model &&
    run.tokenUsage.prompt === stored.tokenUsage.prompt &&
    run.tokenUsage.completion === stored.tokenUsage.completion &&
    run.tokenUsage.total === stored.tokenUsage.total
  )
}

export function AnalysisTab({ captureId, caseId, captureTitle, onOpenNote }: AnalysisTabProps) {
  const navigate = useNavigate()

  // The two pieces of state with no server counterpart: the operator's model
  // pick (null until they override the stored default) and the 2s copy flash.
  const [modelOverride, setModelOverride] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: settings } = useQuery(settingsQueryOptions)
  const { data: savedAnalysis, isLoading: isLoadingSaved } = useQuery(
    captureAnalysisQueryOptions(captureId)
  )
  const { models } = useOpenRouterModels(settings?.openRouterApiKey)
  const { analyze, saveAnalysis } = useAiMutations()

  const selectedModel = modelOverride ?? settings?.defaultModel ?? ''

  // The tab stays mounted while the capture selection moves, so a run has to
  // be scoped to the capture it was started for or the previous capture's
  // analysis renders under the new one. Comparing the mutation's own variables
  // does that in the same render — a reset effect would clear the stale result
  // only after a frame that had already shown it against the wrong capture.
  const runIsForThisCapture = analyze.variables?.captureId === captureId
  const run = runIsForThisCapture ? analyze.data : undefined
  const isAnalyzing = analyze.isPending && runIsForThisCapture
  const analyzeError = runIsForThisCapture ? (analyze.error?.message ?? null) : null
  const isSaving = saveAnalysis.isPending && saveAnalysis.variables?.captureId === captureId

  // A fresh run wins over the stored row; otherwise the stored row is what the
  // capture has. "Unsaved" is then a fact about the two rather than a flag:
  // the save writes through to the cache, so the row and the run agree the
  // moment the write lands.
  const content = run?.content ?? savedAnalysis?.content ?? null
  const tokenUsage = run?.tokenUsage ?? savedAnalysis?.tokenUsage ?? null
  const hasUnsavedChanges = !!run && !runIsStored(run, savedAnalysis)
  // The run's own stamp is not persisted, so it can only stand in until the row
  // exists. Once the run is stored, the footer has to read the row's timestamp
  // or it shows the moment of analysis beside "✓ Saved" while the row — and
  // anything reading it later — records the moment of the save.
  const analysisTimestamp = hasUnsavedChanges
    ? (run?.analyzedAt ?? null)
    : (savedAnalysis?.updatedAt ?? savedAnalysis?.createdAt ?? null)

  const handleAnalyze = () => analyze.mutate({ captureId, caseId, model: selectedModel })

  // Content, model and token usage all come off the same run, so the row cannot
  // record one run's output against another run's model.
  const handleSave = () => {
    if (!run) return
    saveAnalysis.mutate({
      captureId,
      caseId,
      content: run.content,
      model: run.model,
      tokenUsage: run.tokenUsage,
      existing: savedAnalysis
    })
  }

  const handleCopyToClipboard = async () => {
    if (!content) return
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const hasApiKey = !!settings?.openRouterApiKey

  // --- No API key state ---
  if (settings && !hasApiKey) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <Settings className="h-10 w-10 text-text-faint" />
        <div>
          <h3 className="text-sm font-semibold text-text-primary">AI Analysis Not Configured</h3>
          <p className="mt-1 max-w-sm text-xs text-text-muted">
            Set up your OpenRouter API key in Settings to enable AI-powered capture analysis.
          </p>
        </div>
        <Button size="sm" variant="default" onClick={() => navigate({ to: '/settings' })}>
          Open Settings
        </Button>
      </div>
    )
  }

  // --- Loading saved state ---
  if (isLoadingSaved || !settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      </div>
    )
  }

  // --- Ready state (no analysis yet) ---
  if (!content && !isAnalyzing && !analyzeError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <Sparkles className="h-10 w-10 text-accent/50" />
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Analyze this capture</h3>
          <p className="mt-1 max-w-sm text-xs text-text-muted">
            Get an AI-generated assessment of this capture's content, informed by the case context
            and metadata.
          </p>
        </div>
        {models.length > 0 && (
          <select
            value={selectedModel}
            onChange={(e) => setModelOverride(e.target.value)}
            className="w-64 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <Button size="sm" onClick={handleAnalyze} disabled={isAnalyzing}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          Analyze
        </Button>
      </div>
    )
  }

  // --- Error state ---
  if (analyzeError && !content) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
          <h3 className="text-sm font-semibold text-red-400">Analysis Failed</h3>
          <p className="mt-1 max-w-sm text-xs text-red-400/80">{analyzeError}</p>
        </div>
        <Button size="sm" onClick={handleAnalyze}>
          Retry
        </Button>
      </div>
    )
  }

  // --- Loading vs results: crossfade ---
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <AnimatePresence mode="wait">
        {isAnalyzing ? (
          <motion.div
            key="analyzing"
            className="flex h-full flex-col items-center justify-center gap-3 p-8"
            initial={presets.fadeIn.initial}
            animate={presets.fadeIn.animate}
            exit={presets.fadeIn.exit}
            transition={presets.fadeIn.transition}
          >
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
            <p className="text-xs text-text-muted">Analyzing capture...</p>
          </motion.div>
        ) : (
          <motion.div
            key="results"
            className="flex h-full flex-col"
            initial={presets.fadeIn.initial}
            animate={presets.fadeIn.animate}
            exit={presets.fadeIn.exit}
            transition={presets.fadeIn.transition}
          >
            {/* Toolbar */}
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              {models.length > 0 ? (
                <select
                  value={selectedModel}
                  onChange={(e) => setModelOverride(e.target.value)}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[11px] font-mono text-text-muted">{selectedModel}</span>
              )}

              <div className="flex-1" />

              <Button
                variant="ghost"
                size="sm"
                onClick={handleAnalyze}
                disabled={isAnalyzing}
                title="Re-analyze"
              >
                <RefreshCw className={`mr-1 h-3 w-3 ${isAnalyzing ? 'animate-spin' : ''}`} />
                <span className="text-[11px]">Re-analyze</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleSave}
                disabled={isSaving || !hasUnsavedChanges}
                title={savedAnalysis && hasUnsavedChanges ? 'Save changes' : 'Save'}
              >
                <Save className="mr-1 h-3 w-3" />
                <span className="text-[11px]">
                  {isSaving
                    ? 'Saving...'
                    : savedAnalysis && hasUnsavedChanges
                      ? 'Save Changes'
                      : 'Save'}
                </span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyToClipboard}
                title="Copy to clipboard"
              >
                <Copy className="mr-1 h-3 w-3" />
                <span className="text-[11px]">{copied ? 'Copied!' : 'Copy'}</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenNote(`AI Analysis — ${captureTitle}`, content ?? '')}
                title="Copy to note"
              >
                <StickyNote className="mr-1 h-3 w-3" />
                <span className="text-[11px]">Note</span>
              </Button>

              {tokenUsage && (
                <span className="text-[10px] text-text-faint">
                  {tokenUsage.total.toLocaleString()} tokens
                </span>
              )}
            </div>

            {/* Markdown content */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="prose prose-sm prose-invert max-w-none text-text-secondary [&_h1]:text-text-primary [&_h2]:text-text-primary [&_h3]:text-text-primary [&_strong]:text-text-primary [&_a]:text-accent [&_code]:rounded [&_code]:bg-elevated [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_pre]:bg-elevated [&_pre]:p-3 [&_li]:text-text-secondary [&_ul]:text-text-secondary [&_ol]:text-text-secondary">
                <Markdown
                  components={{
                    // Disallow images to prevent external network requests from AI output
                    img: () => null,
                    // Open links externally via shell rather than in-app navigation
                    a: ({
                      href,
                      children
                    }: React.AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps) => (
                      <a
                        href={href}
                        rel="noreferrer noopener"
                        onClick={(e) => {
                          e.preventDefault()
                          if (href) openCaptureExternal(href)
                        }}
                      >
                        {children}
                      </a>
                    )
                  }}
                >
                  {content ?? ''}
                </Markdown>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 border-t border-border px-3 py-1.5">
              {analysisTimestamp && (
                <span className="text-[10px] text-text-faint">
                  {new Date(analysisTimestamp).toLocaleString()}
                </span>
              )}
              <div className="flex-1" />
              <span className="text-[10px] text-text-faint">
                {hasUnsavedChanges ? '⚡ Unsaved' : savedAnalysis ? '✓ Saved' : ''}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
