import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import Markdown from 'react-markdown'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, Save, RefreshCw, StickyNote, Settings, Sparkles, Copy } from 'lucide-react'
import { Button } from '@renderer/components/ui'
import {
  settingsQueryOptions,
  openRouterModelsQueryOptions,
  captureAnalysisQueryOptions,
  useCaptureAnalysisMutations
} from '@renderer/lib/queries'

interface AnalysisTabProps {
  captureId: string
  caseId: string
  captureTitle: string
  onOpenNote: (prefillTitle: string, prefillBody: string) => void
}

export function AnalysisTab({ captureId, caseId, captureTitle, onOpenNote }: AnalysisTabProps) {
  const navigate = useNavigate()
  const { data: settings } = useQuery(settingsQueryOptions)
  const { data: models = [] } = useQuery(
    openRouterModelsQueryOptions(settings?.openRouterApiKey ?? null)
  )
  const { data: savedAnalysis, isLoading: isLoadingSaved } = useQuery(
    captureAnalysisQueryOptions(captureId)
  )
  const { upsert } = useCaptureAnalysisMutations(captureId)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const modelId = selectedModel ?? savedAnalysis?.model ?? settings?.defaultModel ?? ''

  const analyze = useMutation({
    mutationFn: () => window.birdbrain.ai.analyze({ captureId, caseId, model: modelId })
  })

  const display = analyze.data ?? savedAnalysis
  const hasUnsavedChanges =
    !!analyze.data && (!savedAnalysis || analyze.data.content !== savedAnalysis.content)

  const hasApiKey = !!settings?.openRouterApiKey
  const isAnalyzing = analyze.isPending
  const isSaving = upsert.isPending

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

  if (isLoadingSaved || !settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      </div>
    )
  }

  if (!display && !isAnalyzing && !analyze.error) {
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
            value={modelId}
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
        <Button size="sm" onClick={() => analyze.mutate()} disabled={isAnalyzing || !modelId}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          Analyze
        </Button>
      </div>
    )
  }

  if (analyze.error && !display) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
          <h3 className="text-sm font-semibold text-red-400">Analysis Failed</h3>
          <p className="mt-1 max-w-sm text-xs text-red-400/80">{analyze.error.message}</p>
        </div>
        <Button size="sm" onClick={() => analyze.mutate()}>
          Retry
        </Button>
      </div>
    )
  }

  if (isAnalyzing && !display) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
        <p className="text-xs text-text-muted">Analyzing capture...</p>
      </div>
    )
  }

  const timestamp = display && 'updatedAt' in display ? display.updatedAt : null

  async function handleCopy(): Promise<void> {
    if (!display) return
    await navigator.clipboard.writeText(display.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleSave(): void {
    if (!display) return
    upsert.mutate({
      captureId,
      caseId,
      content: display.content,
      model: modelId,
      tokenUsage: display.tokenUsage
    })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {models.length > 0 ? (
          <select
            value={modelId}
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
          <span className="text-[11px] font-mono text-text-muted">{modelId}</span>
        )}

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="sm"
          onClick={() => analyze.mutate()}
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
            {isSaving ? 'Saving...' : savedAnalysis && hasUnsavedChanges ? 'Save Changes' : 'Save'}
          </span>
        </Button>

        <Button variant="ghost" size="sm" onClick={handleCopy} title="Copy to clipboard">
          <Copy className="mr-1 h-3 w-3" />
          <span className="text-[11px]">{copied ? 'Copied!' : 'Copy'}</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpenNote(`AI Analysis — ${captureTitle}`, display?.content ?? '')}
          title="Copy to note"
        >
          <StickyNote className="mr-1 h-3 w-3" />
          <span className="text-[11px]">Note</span>
        </Button>

        {display?.tokenUsage && (
          <span className="text-[10px] text-text-faint">
            {display.tokenUsage.total.toLocaleString()} tokens
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="prose prose-sm prose-invert max-w-none text-text-secondary [&_h1]:text-text-primary [&_h2]:text-text-primary [&_h3]:text-text-primary [&_strong]:text-text-primary [&_a]:text-accent [&_code]:rounded [&_code]:bg-elevated [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_pre]:bg-elevated [&_pre]:p-3 [&_li]:text-text-secondary [&_ul]:text-text-secondary [&_ol]:text-text-secondary">
          <Markdown
            components={{
              // Disallow images to prevent external network requests from AI output
              img: () => null,
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
            {display?.content ?? ''}
          </Markdown>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-border px-3 py-1.5">
        {timestamp && (
          <span className="text-[10px] text-text-faint">
            {new Date(timestamp).toLocaleString()}
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
