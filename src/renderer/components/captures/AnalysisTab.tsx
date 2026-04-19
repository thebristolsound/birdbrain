import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { v4 as uuid } from 'uuid'
import Markdown from 'react-markdown'
import { Button } from '@renderer/components/ui'
import { Loader2, Save, RefreshCw, StickyNote, Settings, Sparkles, Copy } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import type { CaptureAnalysis, BirdbrainSettings, TokenUsage } from '@shared/types'
import { useOpenRouterModels } from '@renderer/hooks/useOpenRouterModels'

interface AnalysisTabProps {
  captureId: string
  caseId: string
  captureTitle: string
  onOpenNote: (prefillTitle: string, prefillBody: string) => void
}

export function AnalysisTab({ captureId, caseId, captureTitle, onOpenNote }: AnalysisTabProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [settings, setSettings] = useState<BirdbrainSettings | null>(null)
  const [selectedModel, setSelectedModel] = useState('')
  const [liveContent, setLiveContent] = useState<string | null>(null)
  const [liveTokenUsage, setLiveTokenUsage] = useState<TokenUsage | null>(null)
  const [analysisTimestamp, setAnalysisTimestamp] = useState<string | null>(null)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [copied, setCopied] = useState(false)

  // Load settings once; selectedModel seeds from the stored default.
  useEffect(() => {
    window.birdbrain.settings.get().then((s) => {
      setSettings(s)
      setSelectedModel(s.defaultModel)
    })
  }, [])

  const { models } = useOpenRouterModels(settings?.openRouterApiKey)

  // Load saved analysis
  const { data: savedAnalysis, isLoading: isLoadingSaved } = useQuery({
    queryKey: ['analysis', captureId],
    queryFn: () => window.birdbrain.ai.getAnalysis(captureId),
    enabled: !!captureId
  })

  // Reset local analysis state when switching captures to avoid showing stale data
  useEffect(() => {
    setLiveContent(null)
    setLiveTokenUsage(null)
    setAnalysisTimestamp(null)
    setAnalyzeError(null)
    setHasUnsavedChanges(false)
  }, [captureId])

  // When saved analysis loads, populate the live state or clear it if none exists
  useEffect(() => {
    if (savedAnalysis) {
      setLiveContent(savedAnalysis.content)
      setLiveTokenUsage(savedAnalysis.tokenUsage)
      setAnalysisTimestamp(savedAnalysis.updatedAt || savedAnalysis.createdAt)
      setHasUnsavedChanges(false)
      setAnalyzeError(null)
    } else {
      setLiveContent(null)
      setLiveTokenUsage(null)
      setAnalysisTimestamp(null)
      setAnalyzeError(null)
      setHasUnsavedChanges(false)
    }
  }, [savedAnalysis])

  // Analyze mutation
  const analyzeMutation = useMutation({
    mutationFn: () =>
      window.birdbrain.ai.analyze({
        captureId,
        caseId,
        model: selectedModel
      }),
    onSuccess: (result) => {
      setLiveContent(result.content)
      setLiveTokenUsage(result.tokenUsage)
      setAnalysisTimestamp(new Date().toISOString())
      setHasUnsavedChanges(true)
      setAnalyzeError(null)
    },
    onError: (err: Error) => {
      setAnalyzeError(err.message)
    }
  })

  // Save mutation — saveAnalysis is upsert-by-captureId in the main process
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!liveContent || !liveTokenUsage) return
      const now = new Date().toISOString()
      const analysis: CaptureAnalysis = {
        id: savedAnalysis?.id ?? uuid(),
        captureId,
        caseId,
        content: liveContent,
        model: selectedModel,
        tokenUsage: liveTokenUsage,
        createdAt: savedAnalysis?.createdAt ?? now,
        updatedAt: now
      }
      await window.birdbrain.ai.saveAnalysis(analysis)
    },
    onSuccess: () => {
      setHasUnsavedChanges(false)
      queryClient.invalidateQueries({ queryKey: ['analysis', captureId] })
    }
  })

  const handleCopyToClipboard = async () => {
    if (!liveContent) return
    await navigator.clipboard.writeText(liveContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const hasApiKey = !!settings?.openRouterApiKey
  const isAnalyzing = analyzeMutation.isPending
  const isSaving = saveMutation.isPending

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
        <Button size="sm" onClick={() => analyzeMutation.mutate()} disabled={isAnalyzing}>
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
        <Button size="sm" onClick={() => analyzeMutation.mutate()}>
          Retry
        </Button>
      </div>
    )
  }

  // --- Loading state (analyzing) ---
  if (isAnalyzing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
        <p className="text-xs text-text-muted">Analyzing capture...</p>
      </div>
    )
  }

  // --- Results state ---
  return (
    <div className="flex h-full flex-col">
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
          onClick={() => analyzeMutation.mutate()}
          disabled={isAnalyzing}
          title="Re-analyze"
        >
          <RefreshCw className={`mr-1 h-3 w-3 ${isAnalyzing ? 'animate-spin' : ''}`} />
          <span className="text-[11px]">Re-analyze</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => saveMutation.mutate()}
          disabled={isSaving || !hasUnsavedChanges}
          title={savedAnalysis && hasUnsavedChanges ? 'Save changes' : 'Save'}
        >
          <Save className="mr-1 h-3 w-3" />
          <span className="text-[11px]">
            {isSaving ? 'Saving...' : savedAnalysis && hasUnsavedChanges ? 'Save Changes' : 'Save'}
          </span>
        </Button>

        <Button variant="ghost" size="sm" onClick={handleCopyToClipboard} title="Copy to clipboard">
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
              a: ({ href, children }) => (
                <a
                  href={href}
                  rel="noreferrer noopener"
                  onClick={(e) => {
                    e.preventDefault()
                    if (href) window.birdbrain.captures.openExternal(href)
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
    </div>
  )
}
