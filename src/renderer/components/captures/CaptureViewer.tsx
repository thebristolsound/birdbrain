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
  StickyNote,
  MoreHorizontal,
  Sparkles
} from 'lucide-react'
import { AddNoteModal } from '@renderer/components/notes/AddNoteModal'
import { MhtmlViewer } from '@renderer/components/captures/MhtmlViewer'
import { ProvenanceBadge } from '@renderer/components/captures/ProvenanceBadge'
import { AnalysisTab } from '@renderer/components/captures/AnalysisTab'
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@renderer/components/ui'

type ViewTab = 'screenshot' | 'page' | 'source' | 'text' | 'metadata' | 'analysis'

const TABS: ViewTab[] = ['screenshot', 'page', 'source', 'text', 'metadata', 'analysis']

const TAB_ICONS: Record<ViewTab, typeof Image> = {
  screenshot: Image,
  page: Globe,
  source: Code,
  text: FileText,
  metadata: Info,
  analysis: Sparkles
}

const TAB_LABELS: Record<ViewTab, string> = {
  screenshot: 'Screenshot',
  page: 'Page',
  source: 'Source',
  text: 'Text',
  metadata: 'Metadata',
  analysis: '✦ Analysis'
}

export function CaptureViewer() {
  const { caseId } = useParams({ from: '/cases/$caseId/captures' })
  const selectedCaptureId = useAppStore((s) => s.selectedCaptureId)
  const selectCapture = useAppStore((s) => s.selectCapture)
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))
  const { data: allTags = [] } = useQuery(tagsQueryOptions)
  const { data: captureTags = [] } = useQuery(tagsForCaptureQueryOptions(selectedCaptureId ?? ''))
  const { create: createTag, addToCapture, removeFromCapture } = useTagsMutations()
  const { remove: deleteCaptureMutation } = useCapturesMutations(caseId)

  const [activeTab, setActiveTab] = useState<ViewTab>('screenshot')
  const [capture, setCapture] = useState<Capture | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [showTagMenu, setShowTagMenu] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showAddNote, setShowAddNote] = useState(false)
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#f59e0b')
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [notePrefillTitle, setNotePrefillTitle] = useState('')
  const [notePrefillBody, setNotePrefillBody] = useState('')

  useEffect(() => {
    if (!selectedCaptureId) {
      setCapture(null)
      setContent(null)
      return
    }
    let cancelled = false
    window.birdbrain.captures
      .get(selectedCaptureId)
      .then((c) => {
        if (!cancelled) setCapture(c ?? null)
      })
      .catch((err) => console.error('Failed to load capture:', err))
    return () => {
      cancelled = true
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
    if (!type) return
    let cancelled = false
    window.birdbrain.captures
      .getContent(selectedCaptureId, type)
      .then((c) => {
        if (!cancelled) setContent(c)
      })
      .catch((err) => console.error('Failed to load capture content:', err))
    return () => {
      cancelled = true
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

  if (!selectedCaptureId || !capture || capture.caseId !== caseId) {
    return (
      <main className="flex flex-1 items-center justify-center bg-canvas text-text-muted">
        Select a capture to view
      </main>
    )
  }

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
        <Button variant="ghost" size="icon-sm" onClick={goPrev} disabled={currentIndex <= 0}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={goNext}
          disabled={currentIndex >= captures.length - 1}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        {/* Title + URL + position */}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-sm font-bold text-text-primary">
            {capture.title || hostname}
          </h2>
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[11px] text-text-muted">{capture.url}</span>
            <span className="shrink-0 text-[11px] text-text-faint">·</span>
            <span className="shrink-0 text-[11px] text-text-faint">
              {currentIndex + 1} / {captures.length}
            </span>
            <span className="shrink-0 text-[11px] text-text-faint">·</span>
            <span className="shrink-0 text-[11px] text-text-faint">← →</span>
          </div>
        </div>

        {/* Tag popover trigger */}
        <div className="relative shrink-0">
          <button
            onClick={() => {
              setShowTagMenu(!showTagMenu)
              setNewTagName('')
            }}
            className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] transition-colors ${
              captureTags.length > 0
                ? 'text-text-secondary hover:bg-elevated'
                : 'text-text-muted hover:bg-elevated hover:text-text-secondary'
            }`}
            title="Manage tags"
          >
            <TagIcon className="h-3.5 w-3.5" />
            {captureTags.length > 0 && (
              <span className="rounded-full bg-accent-subtle px-1.5 text-[10px] font-semibold text-accent">
                {captureTags.length}
              </span>
            )}
          </button>

          {showTagMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowTagMenu(false)} />
              <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border-strong bg-card py-1 shadow-xl">
                {/* Applied tags */}
                {captureTags.length > 0 && (
                  <div className="border-b border-border px-3 py-2">
                    <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-faint">
                      Applied
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {captureTags.map((tag) => (
                        <TagBadge
                          key={tag.id}
                          tag={tag}
                          onClick={() => handleToggleTag(tag.id)}
                          removable
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Available tags to add */}
                <div className="max-h-40 overflow-y-auto py-1">
                  {allTags
                    .filter((t) => !captureTags.some((ct) => ct.id === t.id))
                    .map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => handleToggleTag(tag.id)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-elevated"
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: tag.color || '#f59e0b' }}
                        />
                        {tag.name}
                      </button>
                    ))}
                </div>

                {/* Create new tag inline */}
                <div className="border-t border-border px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    {/* Color swatch — click to expand picker */}
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowColorPicker(!showColorPicker)}
                        className="flex h-4 w-4 items-center justify-center rounded-full ring-1 ring-border transition-transform hover:scale-110"
                        style={{ backgroundColor: newTagColor }}
                        title="Pick color"
                      />
                      {showColorPicker && (
                        <div className="absolute bottom-full left-0 mb-1 flex flex-col gap-1 rounded-lg border border-border-strong bg-card p-1.5 shadow-lg">
                          {[
                            '#f59e0b',
                            '#ef4444',
                            '#22c55e',
                            '#3b82f6',
                            '#a855f7',
                            '#ec4899',
                            '#14b8a6',
                            '#f97316'
                          ].map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => {
                                setNewTagColor(c)
                                setShowColorPicker(false)
                              }}
                              className={`h-4 w-4 rounded-full transition-transform hover:scale-125 ${
                                c === newTagColor ? 'ring-2 ring-accent ring-offset-1' : ''
                              }`}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    <input
                      type="text"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter' && newTagName.trim()) {
                          const tag = await createTag.mutateAsync({
                            name: newTagName.trim(),
                            color: newTagColor
                          })
                          if (selectedCaptureId) {
                            await addToCapture.mutateAsync({
                              captureId: selectedCaptureId,
                              tagId: tag.id
                            })
                          }
                          setNewTagName('')
                        }
                      }}
                      placeholder="New tag..."
                      className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-faint focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-1">
          <ProvenanceBadge key={capture.id} capture={capture} />
          <Button variant="ghost" size="icon-sm" onClick={handleDownload} title="Download capture">
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleOpenExternal}
            title="Open URL in browser"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>

          {/* Overflow menu */}
          <div className="relative">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowOverflowMenu(!showOverflowMenu)}
              title="More actions"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
            {showOverflowMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowOverflowMenu(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-border-strong bg-elevated py-1 shadow-lg">
                  <button
                    data-testid="add-note-button"
                    onClick={() => {
                      setShowAddNote(true)
                      setShowOverflowMenu(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-surface"
                  >
                    <StickyNote className="h-3.5 w-3.5" />
                    Add note
                  </button>
                  <button
                    onClick={() => {
                      setShowDeleteConfirm(true)
                      setShowOverflowMenu(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-surface"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete capture
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sub-tabs row */}
      <div className="flex items-center gap-1 border-b border-border bg-surface px-3">
        {TABS.map((tab) => {
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

      {/* B) Content area */}
      <div className="flex-1 overflow-hidden min-h-0">
        {activeTab === 'screenshot' &&
          (content ? (
            <div className="h-full overflow-y-auto p-4">
              <Card className="overflow-hidden">
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
              </Card>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-1 p-8 text-center">
              <p className="text-sm text-text-muted">No screenshot available</p>
              <p className="text-xs text-text-faint">
                Screenshot may not have been captured or exceeded the size limit.
              </p>
            </div>
          ))}
        {activeTab === 'page' && capture.format === 'mhtml' ? (
          <div className="h-full w-full overflow-hidden">
            <MhtmlViewer captureId={capture.id} />
          </div>
        ) : activeTab === 'page' ? (
          content ? (
            <iframe
              sandbox=""
              srcDoc={content}
              className="h-full w-full border-0 bg-white"
              title="Archived page"
            />
          ) : (
            <div className="p-4 text-text-muted">No HTML available</div>
          )
        ) : null}
        {activeTab === 'source' &&
          (content ? (
            <div className="h-full overflow-y-auto p-4">
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-text-muted">
                {content}
              </pre>
            </div>
          ) : (
            <div className="p-4 text-text-muted">No HTML available</div>
          ))}
        {activeTab === 'text' &&
          (content ? (
            <div className="h-full overflow-y-auto p-4">
              <pre className="whitespace-pre-wrap font-mono text-sm text-text-muted">{content}</pre>
            </div>
          ) : (
            <div className="p-4 text-text-muted">No text content available</div>
          ))}
        {activeTab === 'metadata' && (
          <div className="h-full overflow-y-auto p-4">
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
          </div>
        )}
        {activeTab === 'analysis' && (
          <AnalysisTab
            captureId={capture.id}
            caseId={caseId}
            captureTitle={capture.title || ''}
            onOpenNote={(prefillTitle, prefillBody) => {
              setNotePrefillTitle(prefillTitle)
              setNotePrefillBody(prefillBody)
              setShowAddNote(true)
            }}
          />
        )}
      </div>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent onClose={() => setShowDeleteConfirm(false)} className="w-80 max-w-80 p-5">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-sm">Delete Capture?</DialogTitle>
            <DialogDescription className="text-xs">
              This will permanently remove the capture and its files. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AddNoteModal
        open={showAddNote}
        caseId={caseId}
        captureId={capture.id}
        captureTitle={capture.title || ''}
        captureUrl={capture.url}
        prefillTitle={notePrefillTitle || undefined}
        prefillBody={notePrefillBody || undefined}
        onClose={() => {
          setShowAddNote(false)
          setNotePrefillTitle('')
          setNotePrefillBody('')
        }}
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
