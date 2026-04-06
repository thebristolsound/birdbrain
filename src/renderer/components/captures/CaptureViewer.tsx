import { useState, useEffect, useCallback } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import {
  capturesQueryOptions,
  tagsQueryOptions,
  tagsForCaptureQueryOptions,
  useTagsMutations,
  useCapturesMutations
} from '@renderer/lib/queries'
import { TagBadge } from '@renderer/components/tags/TagBadge'
import type { Capture } from '@shared/types'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Trash2,
  Image,
  Globe,
  Code,
  FileText,
  Info,
  Tag as TagIcon,
  Plus,
  StickyNote
} from 'lucide-react'
import { AddNoteModal } from '@renderer/components/notes/AddNoteModal'
import { MhtmlViewer } from '@renderer/components/captures/MhtmlViewer'
import { ProvenanceBadge } from '@renderer/components/captures/ProvenanceBadge'

type ViewTab = 'screenshot' | 'page' | 'source' | 'text' | 'metadata'

const TABS: ViewTab[] = ['screenshot', 'page', 'source', 'text', 'metadata']

const TAB_ICONS: Record<ViewTab, typeof Image> = {
  screenshot: Image,
  page: Globe,
  source: Code,
  text: FileText,
  metadata: Info
}

const TAB_LABELS: Record<ViewTab, string> = {
  screenshot: 'Screenshot',
  page: 'Page',
  source: 'Source',
  text: 'Text',
  metadata: 'Metadata'
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
  const { caseId } = useParams({ from: '/cases/$caseId/captures' })
  const selectedCaptureId = useAppStore((s) => s.selectedCaptureId)
  const selectCapture = useAppStore((s) => s.selectCapture)
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))
  const { data: allTags = [] } = useQuery(tagsQueryOptions)
  const { data: captureTags = [] } = useQuery(tagsForCaptureQueryOptions(selectedCaptureId ?? ''))
  const { addToCapture, removeFromCapture } = useTagsMutations()
  const { remove: deleteCaptureMutation } = useCapturesMutations(caseId)

  const [activeTab, setActiveTab] = useState<ViewTab>('screenshot')
  const [capture, setCapture] = useState<Capture | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [showTagMenu, setShowTagMenu] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showAddNote, setShowAddNote] = useState(false)

  useEffect(() => {
    if (selectedCaptureId) {
      window.birdbrain.captures
        .get(selectedCaptureId)
        .then((c) => setCapture(c ?? null))
        .catch((err) => console.error('Failed to load capture:', err))
    } else {
      setCapture(null)
      setContent(null)
    }
  }, [selectedCaptureId])

  // Load content when tab changes
  useEffect(() => {
    if (!selectedCaptureId) return
    setContent(null)
    // For MHTML captures, the 'page' tab uses MhtmlViewer (file URL); only
    // source/text/screenshot tabs need raw content fetching.
    if (capture?.format === 'mhtml' && activeTab === 'page') return
    const type =
      activeTab === 'screenshot'
        ? 'png'
        : activeTab === 'page' || activeTab === 'source'
          ? 'html'
          : activeTab === 'text'
            ? 'txt'
            : null
    if (type) {
      window.birdbrain.captures
        .getContent(selectedCaptureId, type)
        .then(setContent)
        .catch((err) => console.error('Failed to load capture content:', err))
    }
  }, [selectedCaptureId, activeTab, capture?.format])

  const handleToggleTag = useCallback(
    async (tagId: string) => {
      if (!selectedCaptureId) return
      const hasTag = captureTags.some((t) => t.id === tagId)
      if (hasTag) {
        await removeFromCapture.mutateAsync({ captureId: selectedCaptureId, tagId })
      } else {
        await addToCapture.mutateAsync({ captureId: selectedCaptureId, tagId })
      }
    },
    [selectedCaptureId, captureTags, addToCapture, removeFromCapture]
  )

  const handleDownload = async () => {
    if (!selectedCaptureId) return
    await window.birdbrain.captures.download(selectedCaptureId)
  }

  const handleOpenExternal = async () => {
    if (!capture) return
    await window.birdbrain.captures.openExternal(capture.url)
  }

  const handleDelete = async () => {
    if (!selectedCaptureId) return
    const deletedId = selectedCaptureId
    await deleteCaptureMutation.mutateAsync(deletedId)
    setShowDeleteConfirm(false)
    // Navigate away: pick sibling capture or clear selection
    const remaining = captures.filter((c) => c.id !== deletedId)
    if (remaining.length > 0) {
      selectCapture(remaining[0].id)
    } else {
      useAppStore.getState().setSelectedCaptureId(null)
    }
  }

  // Navigation
  const currentIndex = captures.findIndex((c) => c.id === selectedCaptureId)
  const goPrev = useCallback(() => {
    if (currentIndex > 0) selectCapture(captures[currentIndex - 1].id)
  }, [currentIndex, captures, selectCapture])
  const goNext = useCallback(() => {
    if (currentIndex < captures.length - 1) selectCapture(captures[currentIndex + 1].id)
  }, [currentIndex, captures, selectCapture])

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
  }, [goPrev, goNext])

  if (!capture) {
    return (
      <main className="flex flex-1 items-center justify-center bg-canvas text-text-muted">
        Select a capture to view
      </main>
    )
  }

  const tabs = TABS

  let hostname = ''
  try {
    hostname = new URL(capture.url).hostname
  } catch {
    hostname = capture.url
  }

  return (
    <main className="flex flex-1 flex-col overflow-hidden bg-canvas">
      {/* A) Viewer header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        {/* Prev/Next nav */}
        <button
          onClick={goPrev}
          disabled={currentIndex <= 0}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-primary disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          onClick={goNext}
          disabled={currentIndex >= captures.length - 1}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-primary disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        {/* Title + URL + timestamp */}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-sm font-bold text-text-primary">
            {capture.title || hostname}
          </h2>
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[11px] text-text-muted">{capture.url}</span>
            <span className="shrink-0 text-[11px] text-text-faint">
              {formatViewerTimestamp(capture.timestamp)}
            </span>
          </div>
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-1">
          <ProvenanceBadge captureId={capture.id} />
          <button
            data-testid="add-note-button"
            onClick={() => setShowAddNote(true)}
            title="Add note"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-secondary"
          >
            <StickyNote className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleDownload}
            title="Download capture"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-secondary"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleOpenExternal}
            title="Open URL in browser"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-secondary"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            title="Delete capture"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* B) Content area */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'screenshot' &&
          (content ? (
            <div className="neu-card rounded-2xl overflow-hidden">
              {/* Fake browser chrome */}
              <div className="flex items-center gap-2 border-b border-border bg-elevated px-3 py-2">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
                </div>
                <div className="flex-1 rounded-md bg-surface px-3 py-0.5 text-[11px] font-mono text-text-muted truncate">
                  {capture.url}
                </div>
              </div>
              <img src={`data:image/png;base64,${content}`} alt="Screenshot" className="w-full" />
            </div>
          ) : (
            <div className="text-text-muted">No screenshot available</div>
          ))}
        {activeTab === 'page' && capture.format === 'mhtml' ? (
          <div className="h-full w-full rounded-xl border border-border bg-white overflow-hidden">
            <MhtmlViewer captureId={capture.id} />
          </div>
        ) : activeTab === 'page' ? (
          content ? (
            <iframe
              sandbox="allow-same-origin"
              srcDoc={content}
              className="h-full w-full rounded-xl border border-border bg-white"
              style={{ minHeight: '500px' }}
              title="Archived page"
            />
          ) : (
            <div className="text-text-muted">No HTML available</div>
          )
        ) : null}
        {activeTab === 'source' &&
          (content ? (
            <pre className="whitespace-pre-wrap break-all font-mono text-xs text-text-muted">
              {content}
            </pre>
          ) : (
            <div className="text-text-muted">No HTML available</div>
          ))}
        {activeTab === 'text' &&
          (content ? (
            <pre className="whitespace-pre-wrap font-mono text-sm text-text-muted">{content}</pre>
          ) : (
            <div className="text-text-muted">No text content available</div>
          ))}
        {activeTab === 'metadata' && (
          <div className="space-y-3 font-mono text-sm">
            <MetadataRow label="URL" value={capture.url} />
            <MetadataRow label="Timestamp" value={new Date(capture.timestamp).toLocaleString()} />
            <MetadataRow label="Hash (SHA-256)" value={capture.hash} />
            <MetadataRow label="Created" value={new Date(capture.createdAt).toLocaleString()} />
            {capture.headers && (
              <div>
                <div className="text-text-muted">Headers</div>
                <pre className="mt-1 whitespace-pre-wrap text-xs text-text-muted">
                  {capture.headers}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      {/* C) Bottom panel */}
      <div className="border-t border-border bg-surface">
        {/* Sub-tabs row */}
        <div className="flex items-center gap-1 border-b border-border px-3">
          {tabs.map((tab) => {
            const Icon = TAB_ICONS[tab]
            const isActive = activeTab === tab
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`relative flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium transition-colors ${
                  isActive ? 'text-accent' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {TAB_LABELS[tab]}
                {isActive && (
                  <span className="absolute bottom-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-accent" />
                )}
              </button>
            )
          })}
        </div>

        {/* Tag bar */}
        <div className="flex items-center gap-2 px-3 py-2">
          <TagIcon className="h-3.5 w-3.5 text-text-faint" />
          {captureTags.map((tag) => (
            <TagBadge key={tag.id} tag={tag} onClick={() => handleToggleTag(tag.id)} removable />
          ))}
          <div className="relative">
            <button
              onClick={() => setShowTagMenu(!showTagMenu)}
              className="flex items-center gap-1 rounded-lg border border-dashed border-border-strong px-2 py-1 text-[11px] text-text-muted hover:border-accent/30 hover:text-text-muted"
            >
              <Plus className="h-3 w-3" />
              Add tag
            </button>
            {showTagMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowTagMenu(false)} />
                <div className="absolute bottom-full left-0 z-50 mb-1 rounded-lg border border-border bg-elevated py-1 shadow-lg">
                  {allTags
                    .filter((t) => !captureTags.some((ct) => ct.id === t.id))
                    .map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => {
                          handleToggleTag(tag.id)
                          setShowTagMenu(false)
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs text-text-secondary hover:bg-elevated"
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: tag.color || '#f59e0b' }}
                        />
                        {tag.name}
                      </button>
                    ))}
                  {allTags.filter((t) => !captureTags.some((ct) => ct.id === t.id)).length ===
                    0 && <div className="px-3 py-1 text-xs text-text-muted">No more tags</div>}
                </div>
              </>
            )}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Capture position + keyboard hints */}
          <span className="text-[11px] text-text-faint">
            {currentIndex + 1} / {captures.length}
          </span>
          <span className="text-[11px] text-text-faint">← →</span>
        </div>
      </div>

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div className="neu-card w-80 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-sm font-semibold text-text-primary">Delete Capture?</h3>
            <p className="mb-4 text-xs text-text-muted">
              This will permanently remove the capture and its files. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded px-3 py-1.5 text-sm text-text-muted hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      <AddNoteModal
        open={showAddNote}
        caseId={caseId}
        captureId={capture.id}
        captureTitle={capture.title || ''}
        captureUrl={capture.url}
        onClose={() => setShowAddNote(false)}
      />
    </main>
  )
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-text-muted">{label}</div>
      <div className="break-all text-text-secondary">{value}</div>
    </div>
  )
}
