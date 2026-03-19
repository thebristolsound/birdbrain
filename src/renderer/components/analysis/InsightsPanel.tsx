import {
  Sparkles,
  MoreVertical,
  FileText,
  GitBranch,
  Clock,
  Lightbulb,
  ChevronRight,
  CheckCircle,
  AlertTriangle,
  Compass,
  ClipboardCopy
} from 'lucide-react'
import type { CaseAnalysisResult } from '@shared/types'
import { EntityTimeline } from './EntityTimeline'

interface InsightsPanelProps {
  analysis: CaseAnalysisResult | null
  analyzing: boolean
  lastAnalyzedAt?: string
}

const CLUSTER_BORDERS = [
  'border-l-[3px] border-l-amber-500',
  'border-l-[3px] border-l-yellow-500',
  'border-l-[3px] border-l-red-500',
  'border-l-[3px] border-l-indigo-500',
  'border-l-[3px] border-l-emerald-500'
]

const CLUSTER_DOTS = [
  'bg-amber-500',
  'bg-yellow-500',
  'bg-red-500',
  'bg-indigo-500',
  'bg-emerald-500'
]

const BADGE_STYLES: Record<string, string> = {
  person: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  organization: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  email: 'bg-green-500/10 text-green-400 border-green-500/20',
  phone: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  domain: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  ip_address: 'bg-red-500/10 text-red-400 border-red-500/20',
  address: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  date: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  username: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
  crypto_wallet: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  custom: 'bg-slate-500/10 text-slate-400 border-slate-500/20'
}

const SUGGESTION_ICONS: Record<string, { icon: typeof CheckCircle; styles: string }> = {
  action: {
    icon: CheckCircle,
    styles: 'bg-emerald-500/[0.06] border-emerald-500/[0.12]'
  },
  warning: {
    icon: AlertTriangle,
    styles: 'bg-amber-500/[0.06] border-amber-500/[0.12]'
  },
  explore: {
    icon: Compass,
    styles: 'bg-indigo-500/[0.06] border-indigo-500/[0.12]'
  }
}

function getSuggestionConfig(type: string) {
  return SUGGESTION_ICONS[type] || SUGGESTION_ICONS.explore
}

export function InsightsPanel({ analysis, analyzing, lastAnalyzedAt }: InsightsPanelProps) {
  const handleCopy = () => {
    if (!analysis) return
    const text = [
      analysis.summary,
      '',
      'Clusters:',
      ...analysis.clusters.map((c) => `- ${c.name}: ${c.summary}`),
      '',
      'Timeline:',
      ...analysis.timeline.map((t) => `- ${t.observation} (${t.significance})`),
      '',
      'Suggestions:',
      ...analysis.suggestions.map((s) => `- [${s.type}] ${s.description}`)
    ].join('\n')
    navigator.clipboard.writeText(text)
  }

  return (
    <aside className="flex w-[380px] shrink-0 flex-col overflow-hidden border-l border-white/[0.06] bg-slate-900/70">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-100">AI Insights</h3>
            <span className="text-[10px] text-slate-600">
              {analyzing
                ? 'Analyzing…'
                : lastAnalyzedAt
                  ? `Last analyzed ${lastAnalyzedAt}`
                  : 'Not yet analyzed'}
            </span>
          </div>
        </div>
        <button className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-white/[0.05] hover:text-slate-300">
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {!analysis && !analyzing && (
          <div className="rounded-xl border border-white/[0.06] bg-slate-800/50 p-6 text-center">
            <p className="text-sm text-slate-400">
              Click "Re-analyze" to generate AI-powered insights about entity relationships and patterns.
            </p>
            <p className="mt-1 text-xs text-slate-600">
              This sends entity data to OpenRouter and uses API tokens.
            </p>
          </div>
        )}

        {analyzing && (
          <div className="flex items-center justify-center py-12">
            <div className="text-sm text-slate-400">Analyzing case data…</div>
          </div>
        )}

        {analysis && (
          <>
            {/* Summary */}
            {analysis.summary && (
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-indigo-400" />
                  <h4 className="font-display text-xs font-semibold uppercase tracking-wider text-slate-100">
                    Summary
                  </h4>
                </div>
                <div className="rounded-xl border border-indigo-500/15 bg-indigo-500/[0.08] p-4">
                  <p className="text-xs leading-relaxed text-slate-300">{analysis.summary}</p>
                </div>
              </div>
            )}

            {/* Clusters */}
            {analysis.clusters.length > 0 && (
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <GitBranch className="h-3.5 w-3.5 text-indigo-400" />
                  <h4 className="font-display text-xs font-semibold uppercase tracking-wider text-slate-100">
                    Identified Clusters
                  </h4>
                  <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-bold text-indigo-300">
                    {analysis.clusters.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {analysis.clusters.map((cluster, i) => (
                    <div
                      key={i}
                      className={`cluster-card cursor-pointer rounded-xl border border-white/[0.06] bg-slate-800 p-3.5 ${
                        CLUSTER_BORDERS[i % CLUSTER_BORDERS.length]
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${CLUSTER_DOTS[i % CLUSTER_DOTS.length]}`} />
                          <span className="text-xs font-semibold text-slate-100">{cluster.name}</span>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
                      </div>
                      <p className="mb-2.5 text-[11px] leading-relaxed text-slate-400">
                        {cluster.summary}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {cluster.entities.map((entity, j) => {
                          const badgeStyle = BADGE_STYLES.custom
                          return (
                            <span
                              key={j}
                              className={`rounded border px-2 py-0.5 text-[9px] font-semibold ${badgeStyle}`}
                            >
                              {entity}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Timeline */}
            {analysis.timeline.length > 0 && (
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-indigo-400" />
                  <h4 className="font-display text-xs font-semibold uppercase tracking-wider text-slate-100">
                    Timeline
                  </h4>
                </div>
                <EntityTimeline entries={analysis.timeline} />
              </div>
            )}

            {/* Recommendations */}
            {analysis.suggestions.length > 0 && (
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <Lightbulb className="h-3.5 w-3.5 text-indigo-400" />
                  <h4 className="font-display text-xs font-semibold uppercase tracking-wider text-slate-100">
                    Recommendations
                  </h4>
                </div>
                <div className="space-y-2">
                  {analysis.suggestions.map((suggestion, i) => {
                    const config = getSuggestionConfig(suggestion.type)
                    const Icon = config.icon
                    return (
                      <div
                        key={i}
                        className={`flex items-start gap-2.5 rounded-xl border p-3 ${config.styles}`}
                      >
                        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-current opacity-70" />
                        <p className="text-[11px] leading-relaxed text-slate-300">
                          {suggestion.description}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {analysis && (
        <div className="shrink-0 border-t border-white/[0.06] bg-slate-900/70 px-5 py-3">
          <button
            onClick={handleCopy}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-2.5 text-[11px] font-semibold text-indigo-300 transition-colors hover:border-indigo-500/30 hover:bg-indigo-500/[0.18]"
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
            Copy Insights to Clipboard
          </button>
        </div>
      )}
    </aside>
  )
}
