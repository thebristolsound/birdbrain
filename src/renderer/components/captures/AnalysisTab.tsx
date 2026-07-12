import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useQuery } from '@tanstack/react-query'
import Markdown from 'react-markdown'
import type { ExtraProps } from 'react-markdown'
import { Button } from '@renderer/components/ui'
import { Loader2, Save, RefreshCw, StickyNote, Settings, Sparkles, Copy } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useOpenRouterModels } from '@renderer/hooks/useOpenRouterModels'
import { settingsQueryOptions } from '@renderer/lib/api/settings'
import { analysisQueryOptions, useAnalysisMutations } from '@renderer/lib/api/ai'
import { openExternal } from '@renderer/lib/api/system'
import { presets } from '@renderer/lib/motion'

interface AnalysisTabProps {
  captureId: string
  caseId: string
  captureTitle: string
  onOpenNote: (prefillTitle: string, prefillBody: string) => void
}

export function AnalysisTab({ captureId, caseId, captureTitle, onOpenNote }: AnalysisTabProps) {
  const navigate = useNavigate()

  const [selectedModel, setSelectedModel] = useState('')
  const [copied, setCopied] = useState(false)

  // selectedModel seeds from the stored default once settings load.
  const { data: settings } = useQuery(settingsQueryOptions)
  useEffect(() => {
    if (settings && selectedModel === '') setSelectedModel(settings.defaultModel)
  }, [settings, selectedModel])

  const { models } = useOpenRouterModels(settings?.openRouterApiKey)

  // Load saved analysis
  const { data: savedAnalysis, isLoading: isLoadingSaved } = useQuery(
    analysisQueryOptions(captureId)
  )

  const { analyze, saveAnalysis } = useAnalysisMutations(captureId, caseId)
  const { reset: resetAnalyze } = analyze
  const { reset: resetSave } = saveAnalysis

  // Reset mutation state when switching captures to avoid showing stale data
  useEffect(() => {
    resetAnalyze()
    resetSave()
  }, [captureId, resetAnalyze, resetSave])

  // A fresh (unsaved) analyze result takes precedence over the saved analysis.
  const liveContent = analyze.data?.content ?? savedAnalysis?.content ?? null
  const liveTokenUsage = analyze.data?.tokenUsage ?? savedAnalysis?.tokenUsage ?? null
  const analysisTimestamp = analyze.data
    ? analyze.data.completedAt
    : savedAnalysis
      ? savedAnalysis.updatedAt || savedAnalysis.createdAt
      : null
  const hasUnsavedChanges = !!analyze.data
  const analyzeError = analyze.error ? analyze.error.message : null

  const handleSave = () => {
    if (!liveContent || !liveTokenUsage) return
    saveAnalysis.mutate(
      { content: liveContent, model: selectedModel, tokenUsage: liveTokenUsage },
      // Once saved, the upserted analysis is the saved one — drop the live result.
      { onSuccess: () => resetAnalyze() }
    )
  }

  const handleCopyToClipboard = async () => {
    if (!liveContent) return
    await navigator.clipboard.writeText(liveContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const hasApiKey = !!settings?.openRouterApiKey
  const isAnalyzing = analyze.isPending
  const isSaving = saveAnalysis.isPending

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
  if (!liveContent && !isAnalyzing && !analyzeError) {
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
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-64 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <Button size="sm" onClick={() => analyze.mutate(selectedModel)} disabled={isAnalyzing}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          Analyze
        </Button>
      </div>
    )
  }

  // --- Error state ---
  if (analyzeError && !liveContent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
          <h3 className="text-sm font-semibold text-red-400">Analysis Failed</h3>
          <p className="mt-1 max-w-sm text-xs text-red-400/80">{analyzeError}</p>
        </div>
        <Button size="sm" onClick={() => analyze.mutate(selectedModel)}>
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
                  onChange={(e) => setSelectedModel(e.target.value)}
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
                onClick={() => analyze.mutate(selectedModel)}
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
                onClick={() => onOpenNote(`AI Analysis — ${captureTitle}`, liveContent ?? '')}
                title="Copy to note"
              >
                <StickyNote className="mr-1 h-3 w-3" />
                <span className="text-[11px]">Note</span>
              </Button>

              {liveTokenUsage && (
                <span className="text-[10px] text-text-faint">
                  {liveTokenUsage.total.toLocaleString()} tokens
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
                          if (href) openExternal(href)
                        }}
                      >
                        {children}
                      </a>
                    )
                  }}
                >
                  {liveContent ?? ''}
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
