import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import { useCaptures } from '@renderer/hooks/useCaptures'
import { useTags } from '@renderer/hooks/useTags'
import { TagBadge } from '@renderer/components/tags/TagBadge'
import type { Capture, Tag, Entity } from '@shared/types'
import {
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Download,
  ExternalLink,
  Trash2,
  Image,
  Globe,
  Code,
  FileText,
  Info,
  Fingerprint,
  Sparkles,
  Tag as TagIcon,
  Plus
} from 'lucide-react'

type ViewTab = 'screenshot' | 'page' | 'source' | 'text' | 'metadata' | 'entities'

const TAB_ICONS: Record<ViewTab, typeof Image> = {
  screenshot: Image,
  page: Globe,
  source: Code,
  text: FileText,
  metadata: Info,
  entities: Fingerprint
}

const TAB_LABELS: Record<ViewTab, string> = {
  screenshot: 'Screenshot',
  page: 'Page',
  source: 'Source',
  text: 'Text',
  metadata: 'Metadata',
  entities: 'Entities'
}

function formatViewerTimestamp(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
  return new Date(ts).toLocaleDateString()
}

export function CaptureViewer() {
  const { selectedCaptureId, activeCaseId } = useAppStore()
  const { captures, getContent } = useCaptures(activeCaseId)
  const { tags: allTags, addToCapture, removeFromCapture, getForCapture } = useTags()
  const [activeTab, setActiveTab] = useState<ViewTab>('screenshot')
  const [capture, setCapture] = useState<Capture | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [captureTags, setCaptureTags] = useState<Tag[]>([])
  const [showTagMenu, setShowTagMenu] = useState(false)
  const [entities, setEntities] = useState<Entity[]>([])
  const [extracting, setExtracting] = useState(false)
  const [extractionError, setExtractionError] = useState<string | null>(null)
  const [entityFilter, setEntityFilter] = useState<string>('all')
  const [minConfidence, setMinConfidence] = useState(0.5)

  useEffect(() => {
    window.birdbrain.settings.get().then((s) => {
      setMinConfidence(s.minEntityConfidence ?? 0.5)
    })
  }, [])

  useEffect(() => {
    if (selectedCaptureId) {
      window.birdbrain.captures.get(selectedCaptureId).then((c) => setCapture(c ?? null))
      getForCapture(selectedCaptureId).then(setCaptureTags)
      window.birdbrain.ai.getEntities(selectedCaptureId).then(setEntities)
    }
  }, [selectedCaptureId, getForCapture])

  // Load content when tab changes
  useEffect(() => {
    if (!selectedCaptureId) return
    setContent(null)
    const type =
      activeTab === 'screenshot' ? 'png'
        : activeTab === 'page' || activeTab === 'source' ? 'html'
        : activeTab === 'text' ? 'txt'
        : null
    if (type) {
      getContent(selectedCaptureId, type).then(setContent)
    }
  }, [selectedCaptureId, activeTab, getContent])

  const handleToggleTag = useCallback(
    async (tagId: string) => {
      if (!selectedCaptureId) return
      const hasTag = captureTags.some((t) => t.id === tagId)
      if (hasTag) {
        await removeFromCapture(selectedCaptureId, tagId)
      } else {
        await addToCapture(selectedCaptureId, tagId)
      }
      const updated = await getForCapture(selectedCaptureId)
      setCaptureTags(updated)
    },
    [selectedCaptureId, captureTags, addToCapture, removeFromCapture, getForCapture]
  )

  // Navigation
  const currentIndex = captures.findIndex((c) => c.id === selectedCaptureId)
  const { selectCapture } = useAppStore()
  const goPrev = () => {
    if (currentIndex > 0) selectCapture(captures[currentIndex - 1].id)
  }
  const goNext = () => {
    if (currentIndex < captures.length - 1) selectCapture(captures[currentIndex + 1].id)
  }

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  if (!capture) {
    return (
      <main className="flex flex-1 items-center justify-center bg-black text-slate-500">
        Select a capture to view
      </main>
    )
  }

  const tabs: ViewTab[] = ['screenshot', 'page', 'source', 'text', 'metadata', 'entities']

  let hostname = ''
  try {
    hostname = new URL(capture.url).hostname
  } catch {
    hostname = capture.url
  }

  return (
    <main className="flex flex-1 flex-col overflow-hidden bg-black">
      {/* A) Viewer header */}
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        {/* Prev/Next nav */}
        <button
          onClick={goPrev}
          disabled={currentIndex <= 0}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          onClick={goNext}
          disabled={currentIndex >= captures.length - 1}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        {/* Title + URL + timestamp */}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-sm font-bold text-white">
            {capture.title || hostname}
          </h2>
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[11px] text-slate-500">{capture.url}</span>
            <span className="shrink-0 text-[11px] text-slate-600">
              {formatViewerTimestamp(capture.timestamp)}
            </span>
          </div>
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-1">
          <span className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-400">
            <ShieldCheck className="h-3 w-3" />
            Verified
          </span>
          <button className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-white/[0.06] hover:text-slate-300">
            {/* TODO: download handler */}
            <Download className="h-3.5 w-3.5" />
          </button>
          <button className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-white/[0.06] hover:text-slate-300">
            {/* TODO: open external handler */}
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-white/[0.06] hover:text-red-400">
            {/* TODO: delete handler */}
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* B) Content area */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'screenshot' && (
          content ? (
            <div className="neu-card rounded-2xl overflow-hidden">
              {/* Fake browser chrome */}
              <div className="flex items-center gap-2 border-b border-white/[0.06] bg-slate-800/50 px-3 py-2">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
                </div>
                <div className="flex-1 rounded-md bg-white/[0.06] px-3 py-0.5 text-[11px] font-mono text-slate-500 truncate">
                  {capture.url}
                </div>
              </div>
              <img src={`data:image/png;base64,${content}`} alt="Screenshot" className="w-full" />
            </div>
          ) : (
            <div className="text-slate-500">No screenshot available</div>
          )
        )}
        {activeTab === 'page' && (
          content ? (
            <iframe
              sandbox="allow-same-origin"
              srcDoc={content}
              className="h-full w-full rounded-xl border border-white/[0.06] bg-white"
              style={{ minHeight: '500px' }}
              title="Archived page"
            />
          ) : (
            <div className="text-slate-500">No HTML available</div>
          )
        )}
        {activeTab === 'source' && (
          content ? (
            <pre className="whitespace-pre-wrap break-all font-mono text-xs text-slate-400">{content}</pre>
          ) : (
            <div className="text-slate-500">No HTML available</div>
          )
        )}
        {activeTab === 'text' && (
          content ? (
            <pre className="whitespace-pre-wrap font-mono text-sm text-slate-400">{content}</pre>
          ) : (
            <div className="text-slate-500">No text content available</div>
          )
        )}
        {activeTab === 'metadata' && (
          <div className="space-y-3 font-mono text-sm">
            <MetadataRow label="URL" value={capture.url} />
            <MetadataRow label="Timestamp" value={new Date(capture.timestamp).toLocaleString()} />
            <MetadataRow label="Hash (SHA-256)" value={capture.hash} />
            <MetadataRow label="Created" value={new Date(capture.createdAt).toLocaleString()} />
            {capture.headers && (
              <div>
                <div className="text-slate-500">Headers</div>
                <pre className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{capture.headers}</pre>
              </div>
            )}
          </div>
        )}
        {activeTab === 'entities' && (
          <div>
            {extractionError && (
              <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {extractionError}
              </div>
            )}
            {entities.length === 0 && !extracting && !extractionError && (
              <p className="text-center text-sm text-slate-500">
                No entities extracted yet. Click &quot;Extract Entities&quot; to analyze this capture.
              </p>
            )}
            {entities.length > 0 && (
              <div className="mb-3 flex items-center gap-3">
                <select
                  value={entityFilter}
                  onChange={(e) => setEntityFilter(e.target.value)}
                  className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-xs text-slate-300"
                >
                  <option value="all">All types</option>
                  {[...new Set(entities.map((e) => e.type))].map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
                <span className="text-xs text-slate-500">
                  {entities.filter((e) => (e.confidence ?? 0) >= minConfidence).length} of {entities.length} entities
                </span>
              </div>
            )}
            {entities.length > 0 && (
              <div className="space-y-1">
                {entities
                  .filter((e) => (e.confidence ?? 0) >= minConfidence)
                  .filter((e) => entityFilter === 'all' || e.type === entityFilter)
                  .map((entity) => (
                    <div key={entity.id} className="flex items-center gap-3 rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                      <span className="w-24 shrink-0 rounded-md bg-white/[0.06] px-2 py-0.5 text-center text-xs text-slate-400">
                        {entity.type}
                      </span>
                      <span className="flex-1 text-sm font-medium text-slate-200">{entity.value}</span>
                      {entity.confidence !== undefined && (
                        <div className="flex items-center gap-1">
                          <div className="h-1.5 w-16 rounded-full bg-white/[0.06]">
                            <div
                              className="h-full rounded-full bg-indigo-500"
                              style={{ width: `${entity.confidence * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-500">
                            {Math.round(entity.confidence * 100)}%
                          </span>
                        </div>
                      )}
                      <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs ${
                        entity.source === 'rule'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-blue-500/10 text-blue-400'
                      }`}>
                        {entity.source === 'rule' ? 'Rule' : 'AI'}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* C) Bottom panel */}
      <div className="border-t border-white/[0.06] bg-slate-900/50">
        {/* Sub-tabs row */}
        <div className="flex items-center gap-1 border-b border-white/[0.06] px-3">
          {tabs.map((tab) => {
            const Icon = TAB_ICONS[tab]
            const isActive = activeTab === tab
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`relative flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium transition-colors ${
                  isActive ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {TAB_LABELS[tab]}
                {tab === 'entities' && entities.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-indigo-500/20 px-1.5 text-[10px] text-indigo-400">
                    {entities.length}
                  </span>
                )}
                {isActive && (
                  <span className="absolute bottom-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-indigo-400" />
                )}
              </button>
            )
          })}

          {/* Extract Entities button */}
          <button
            onClick={async () => {
              if (!selectedCaptureId) return
              setExtracting(true)
              setExtractionError(null)
              try {
                const result = await window.birdbrain.ai.extractEntities(selectedCaptureId)
                setEntities(result)
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err)
                console.error('Extraction failed:', err)
                setExtractionError(message)
              } finally {
                setExtracting(false)
              }
            }}
            disabled={extracting}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/15 px-2.5 py-1 text-[11px] font-medium text-indigo-300 glow-indigo-btn hover:bg-indigo-500/25 disabled:opacity-50"
          >
            <Sparkles className="h-3 w-3" />
            {extracting ? 'Extracting...' : entities.length > 0 ? 'Re-extract' : 'Extract Entities'}
          </button>
        </div>

        {/* Tag bar */}
        <div className="flex items-center gap-2 px-3 py-2">
          <TagIcon className="h-3.5 w-3.5 text-slate-600" />
          {captureTags.map((tag) => (
            <TagBadge
              key={tag.id}
              tag={tag}
              onClick={() => handleToggleTag(tag.id)}
              removable
            />
          ))}
          <div className="relative">
            <button
              onClick={() => setShowTagMenu(!showTagMenu)}
              className="flex items-center gap-1 rounded-lg border border-dashed border-white/[0.08] px-2 py-1 text-[11px] text-slate-500 hover:border-white/[0.15] hover:text-slate-400"
            >
              <Plus className="h-3 w-3" />
              Add tag
            </button>
            {showTagMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowTagMenu(false)} />
                <div className="absolute bottom-full left-0 z-50 mb-1 rounded-lg border border-white/[0.06] bg-slate-800 py-1 shadow-lg">
                  {allTags
                    .filter((t) => !captureTags.some((ct) => ct.id === t.id))
                    .map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => {
                          handleToggleTag(tag.id)
                          setShowTagMenu(false)
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs text-slate-300 hover:bg-white/[0.06]"
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: tag.color || '#f59e0b' }}
                        />
                        {tag.name}
                      </button>
                    ))}
                  {allTags.filter((t) => !captureTags.some((ct) => ct.id === t.id)).length === 0 && (
                    <div className="px-3 py-1 text-xs text-slate-500">No more tags</div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Capture position + keyboard hints */}
          <span className="text-[11px] text-slate-600">
            {currentIndex + 1} / {captures.length}
          </span>
          <span className="text-[11px] text-slate-700">
            ← →
          </span>
        </div>
      </div>
    </main>
  )
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-slate-500">{label}</div>
      <div className="break-all text-slate-300">{value}</div>
    </div>
  )
}
