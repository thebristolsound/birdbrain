import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import Markdown from 'react-markdown'
import { useNavigate } from '@tanstack/react-router'
import { Copy, Loader2, RefreshCw, Save, Settings, Sparkles, StickyNote } from 'lucide-react'
import { Button } from '@renderer/components/ui'
import {
  captureAnalysisQueryOptions,
  openRouterModelsQueryOptions,
  settingsQueryOptions,
  useCaptureAnalysisMutations
} from '@renderer/lib/queries'
import type { OpenRouterModel } from '@shared/types'

interface AnalysisTabProps {
  captureId: string
  caseId: string
  captureTitle: string
  onOpenNote: (initialTitle: string, initialBody: string) => void
}

export function AnalysisTab({ captureId, caseId, captureTitle, onOpenNote }: AnalysisTabProps) {
  const navigate = useNavigate()
  const { data: settings } = useQuery(settingsQueryOptions)
  const apiKey = settings?.openRouterApiKey ?? null
  const { data: models = [] } = useQuery(openRouterModelsQueryOptions(apiKey))
  const { data: savedAnalysis, isLoading: isLoadingSaved } = useQuery(
    captureAnalysisQueryOptions(captureId)
  )
  const { upsert } = useCaptureAnalysisMutations(captureId)

  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const effectiveModelId = selectedModelId ?? savedAnalysis?.model ?? settings?.defaultModel ?? ''
  const selectedModel: OpenRouterModel | undefined = models.find((m) => m.id === effectiveModelId)

  const analyzeMutation = useMutation({
    mutationFn: () =>
      window.birdbrain.ai.analyze({
        captureId,
        caseId,
        model: effectiveModelId,
        contextLength: selectedModel?.contextLength
      })
  })

  const displayContent = analyzeMutation.data?.content ?? savedAnalysis?.content ?? null
  const displayTokenUsage = analyzeMutation.data?.tokenUsage ?? savedAnalysis?.tokenUsage ?? null
  const displayTimestamp = analyzeMutation.data
    ? new Date().toISOString()
    : (savedAnalysis?.updatedAt ?? savedAnalysis?.createdAt ?? null)
  const hasUnsavedChanges = !!analyzeMutation.data
  const analyzeError = analyzeMutation.error

  const markdown = useMemo(
    () => (displayContent ? <Markdown>{displayContent}</Markdown> : null),
    [displayContent]
  )

  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  const handleCopy = async () => {
    if (!displayContent) return
    await navigator.clipboard.writeText(displayContent)
    setCopied(true)
  }

  const handleSave = () => {
    if (!analyzeMutation.data) return
    upsert.mutate(
      {
        captureId,
        caseId,
        content: analyzeMutation.data.content,
        model: effectiveModelId,
        tokenUsage: analyzeMutation.data.tokenUsage
      },
      { onSuccess: () => analyzeMutation.reset() }
    )
  }

  if (settings && !apiKey) {
    return (
      <EmptyState
        icon={<Settings className="h-10 w-10 text-text-faint" />}
        title="AI Analysis Not Configured"
        body="Set up your OpenRouter API key in Settings to enable AI-powered capture analysis."
        action={
          <Button size="sm" variant="default" onClick={() => navigate({ to: '/settings' })}>
            Open Settings
          </Button>
        }
      />
    )
  }

  if (isLoadingSaved || !settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      </div>
    )
  }

  if (!displayContent && !analyzeMutation.isPending && !analyzeError) {
    return (
      <EmptyState
        icon={<Sparkles className="h-10 w-10 text-accent/50" />}
        title="Analyze this capture"
        body="Get an AI-generated assessment of this capture's content, informed by the case context and metadata."
        action={
          <>
            <ModelSelect
              value={effectiveModelId}
              onChange={setSelectedModelId}
              models={models}
              size="md"
            />
            <Button size="sm" onClick={() => analyzeMutation.mutate()}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Analyze
            </Button>
          </>
        }
      />
    )
  }

  if (analyzeError && !displayContent) {
    return (
      <EmptyState
        icon={null}
        title="Analysis Failed"
        body={analyzeError.message}
        tone="error"
        action={
          <Button size="sm" onClick={() => analyzeMutation.mutate()}>
            Retry
          </Button>
        }
      />
    )
  }

  if (analyzeMutation.isPending) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
        <p className="text-xs text-text-muted">Analyzing capture...</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <ModelSelect
          value={effectiveModelId}
          onChange={setSelectedModelId}
          models={models}
          size="sm"
        />
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => analyzeMutation.mutate()}
          title="Re-analyze"
        >
          <RefreshCw className="mr-1 h-3 w-3" />
          <span className="text-[11px]">Re-analyze</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSave}
          disabled={upsert.isPending || !hasUnsavedChanges}
          title={savedAnalysis && hasUnsavedChanges ? 'Save changes' : 'Save'}
        >
          <Save className="mr-1 h-3 w-3" />
          <span className="text-[11px]">
            {upsert.isPending
              ? 'Saving...'
              : savedAnalysis && hasUnsavedChanges
                ? 'Save Changes'
                : 'Save'}
          </span>
        </Button>
        <Button variant="ghost" size="sm" onClick={handleCopy} title="Copy to clipboard">
          <Copy className="mr-1 h-3 w-3" />
          <span className="text-[11px]">{copied ? 'Copied!' : 'Copy'}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpenNote(`AI Analysis — ${captureTitle}`, displayContent ?? '')}
          title="Copy to note"
        >
          <StickyNote className="mr-1 h-3 w-3" />
          <span className="text-[11px]">Note</span>
        </Button>
        {displayTokenUsage && (
          <span className="text-[10px] text-text-faint">
            {displayTokenUsage.total.toLocaleString()} tokens
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="prose prose-sm prose-invert max-w-none text-text-secondary [&_h1]:text-text-primary [&_h2]:text-text-primary [&_h3]:text-text-primary [&_strong]:text-text-primary [&_a]:text-accent [&_code]:rounded [&_code]:bg-elevated [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_pre]:bg-elevated [&_pre]:p-3 [&_li]:text-text-secondary [&_ul]:text-text-secondary [&_ol]:text-text-secondary">
          {markdown}
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-border px-3 py-1.5">
        {displayTimestamp && (
          <span className="text-[10px] text-text-faint">
            {new Date(displayTimestamp).toLocaleString()}
          </span>
        )}
        <div className="flex-1" />
        <span className="text-[10px] text-text-faint">
          {hasUnsavedChanges ? 'Unsaved' : savedAnalysis ? 'Saved' : ''}
        </span>
      </div>
    </div>
  )
}

interface ModelSelectProps {
  value: string
  onChange: (modelId: string) => void
  models: OpenRouterModel[]
  size: 'sm' | 'md'
}

function ModelSelect({ value, onChange, models, size }: ModelSelectProps) {
  if (models.length === 0) {
    return <span className="font-mono text-[11px] text-text-muted">{value}</span>
  }
  const classes =
    size === 'md'
      ? 'w-64 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent'
      : 'rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent'
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={classes}>
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  )
}

interface EmptyStateProps {
  icon: React.ReactNode
  title: string
  body: string
  action: React.ReactNode
  tone?: 'neutral' | 'error'
}

function EmptyState({ icon, title, body, action, tone = 'neutral' }: EmptyStateProps) {
  const wrap = tone === 'error' ? 'rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3' : ''
  const titleCls =
    tone === 'error'
      ? 'text-sm font-semibold text-red-400'
      : 'text-sm font-semibold text-text-primary'
  const bodyCls =
    tone === 'error'
      ? 'mt-1 max-w-sm text-xs text-red-400/80'
      : 'mt-1 max-w-sm text-xs text-text-muted'
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      {icon}
      <div className={wrap}>
        <h3 className={titleCls}>{title}</h3>
        <p className={bodyCls}>{body}</p>
      </div>
      {action}
    </div>
  )
}
