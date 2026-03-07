import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import { useCaptures } from '@renderer/hooks/useCaptures'
import { useTags } from '@renderer/hooks/useTags'
import { TagBadge } from '@renderer/components/tags/TagBadge'
import type { Capture, Tag, Entity } from '@shared/types'

type ViewTab = 'screenshot' | 'html' | 'text' | 'metadata' | 'entities'

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
      activeTab === 'screenshot' ? 'png' : activeTab === 'html' ? 'html' : activeTab === 'text' ? 'txt' : null
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

  if (!capture) {
    return <div className="text-neutral-500">Select a capture to view</div>
  }

  const tabs: { id: ViewTab; label: string }[] = [
    { id: 'screenshot', label: 'Screenshot' },
    { id: 'html', label: 'HTML' },
    { id: 'text', label: 'Text' },
    { id: 'metadata', label: 'Metadata' },
    { id: 'entities', label: 'Entities' }
  ]

  return (
    <div className="flex h-full flex-col">
      {/* Navigation + Title */}
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={goPrev}
          disabled={currentIndex <= 0}
          className="rounded p-1 text-neutral-400 hover:text-neutral-200 disabled:opacity-30"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="truncate text-lg font-semibold text-neutral-100">{capture.title}</h2>
          <a
            className="truncate block font-mono text-xs text-amber-600 hover:text-amber-400"
            title={capture.url}
          >
            {capture.url}
          </a>
        </div>
        <button
          onClick={goNext}
          disabled={currentIndex >= captures.length - 1}
          className="rounded p-1 text-neutral-400 hover:text-neutral-200 disabled:opacity-30"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Tab Bar */}
      <div className="mb-4 flex gap-1 border-b border-neutral-800">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-sm ${
              activeTab === tab.id
                ? 'border-b-2 border-amber-500 text-amber-500'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto rounded border border-neutral-800 bg-neutral-900 p-4">
        {activeTab === 'screenshot' && (
          content ? (
            <img src={`data:image/png;base64,${content}`} alt="Screenshot" className="max-w-full" />
          ) : (
            <div className="text-neutral-500">No screenshot available</div>
          )
        )}
        {activeTab === 'html' && (
          content ? (
            <pre className="whitespace-pre-wrap break-all font-mono text-xs text-neutral-300">{content}</pre>
          ) : (
            <div className="text-neutral-500">No HTML available</div>
          )
        )}
        {activeTab === 'text' && (
          content ? (
            <pre className="whitespace-pre-wrap font-mono text-sm text-neutral-300">{content}</pre>
          ) : (
            <div className="text-neutral-500">No text content available</div>
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
                <div className="text-neutral-500">Headers</div>
                <pre className="mt-1 whitespace-pre-wrap text-xs text-neutral-400">{capture.headers}</pre>
              </div>
            )}
          </div>
        )}
        {activeTab === 'entities' && (
          <div>
            <div className="mb-3 flex items-center gap-3">
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
                className="rounded bg-amber-600 px-3 py-1 text-sm text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {extracting ? 'Extracting...' : entities.length > 0 ? 'Re-extract' : 'Extract Entities'}
              </button>
              {entities.length > 0 && (
                <select
                  value={entityFilter}
                  onChange={(e) => setEntityFilter(e.target.value)}
                  className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-300"
                >
                  <option value="all">All types</option>
                  {[...new Set(entities.map((e) => e.type))].map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              )}
              <span className="text-xs text-neutral-500">{entities.length} entities</span>
            </div>
            {extractionError && (
              <div className="mb-3 rounded border border-red-800 bg-red-900/30 px-3 py-2 text-sm text-red-400">
                {extractionError}
              </div>
            )}
            {entities.length === 0 && !extracting && !extractionError && (
              <p className="text-center text-sm text-neutral-500">
                No entities extracted yet. Click "Extract Entities" to analyze this capture.
              </p>
            )}
            {entities.length > 0 && (
              <div className="space-y-1">
                {entities
                  .filter((e) => entityFilter === 'all' || e.type === entityFilter)
                  .map((entity) => (
                    <div key={entity.id} className="flex items-center gap-3 rounded bg-neutral-800/50 px-3 py-2">
                      <span className="w-24 shrink-0 rounded bg-neutral-700 px-2 py-0.5 text-center text-xs text-neutral-400">
                        {entity.type}
                      </span>
                      <span className="flex-1 text-sm font-medium text-neutral-200">{entity.value}</span>
                      {entity.confidence !== undefined && (
                        <div className="flex items-center gap-1">
                          <div className="h-1.5 w-16 rounded-full bg-neutral-700">
                            <div
                              className="h-full rounded-full bg-amber-500"
                              style={{ width: `${entity.confidence * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-neutral-500">
                            {Math.round(entity.confidence * 100)}%
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tag Bar */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-neutral-500">Tags:</span>
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
            className="rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
          >
            + Add tag
          </button>
          {showTagMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowTagMenu(false)} />
              <div className="absolute bottom-full left-0 z-50 mb-1 rounded border border-neutral-700 bg-neutral-800 py-1 shadow-lg">
                {allTags
                  .filter((t) => !captureTags.some((ct) => ct.id === t.id))
                  .map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => {
                        handleToggleTag(tag.id)
                        setShowTagMenu(false)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs text-neutral-300 hover:bg-neutral-700"
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: tag.color || '#f59e0b' }}
                      />
                      {tag.name}
                    </button>
                  ))}
                {allTags.filter((t) => !captureTags.some((ct) => ct.id === t.id)).length === 0 && (
                  <div className="px-3 py-1 text-xs text-neutral-500">No more tags</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-neutral-500">{label}</div>
      <div className="break-all text-neutral-300">{value}</div>
    </div>
  )
}
