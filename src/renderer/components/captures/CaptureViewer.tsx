import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAppStore, type CaptureViewerTab } from '@renderer/stores/appStore'
import { capturesQueryOptions, captureContentQueryOptions } from '@renderer/lib/queries'
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  FileCode,
  FileText,
  History,
  ImageIcon,
  type LucideIcon
} from 'lucide-react'
import { MhtmlViewer } from '@renderer/components/captures/MhtmlViewer'
import { CaptureTextPanel } from '@renderer/components/captures/CaptureTextPanel'
import { LegacyHtmlViewer } from '@renderer/components/captures/LegacyHtmlViewer'
import { AnnotationEditor } from '@renderer/components/captures/annotation/AnnotationEditor'
import { Button } from '@renderer/components/ui'
import { CaptureViewerToolbar } from '@renderer/components/captures/CaptureViewerToolbar'
import { CaptureDownloadMenu } from '@renderer/components/captures/CaptureDownloadMenu'
import { BrowserChromeFrame } from '@renderer/components/captures/BrowserChromeFrame'
import { WaybackCompare } from '@renderer/components/captures/WaybackCompare'
import { useAnnotationEditor } from '@renderer/components/captures/annotation/useAnnotationEditor'
import { useZoomPan } from '@renderer/components/captures/annotation/useZoomPan'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { CAPTURE_METHOD_LABELS } from '@renderer/components/captures/captureMethodLabel'
import { formatCaptureTimestampFull } from '@renderer/lib/formatRelativeTime'

// Source is gone: Page *is* the MHTML, so the two tabs rendered the same
// artifact twice. The raw file is still one click away in the download menu.
const TABS: CaptureViewerTab[] = ['screenshot', 'page', 'text', 'wayback']

const TAB_LABELS: Record<CaptureViewerTab, string> = {
  screenshot: 'Screenshot',
  page: 'Page',
  text: 'Text',
  wayback: 'Wayback'
}

// Stands in for the label below the toolbar's wide tier (#466). Each tab keeps
// its label as an aria-label, so the icon-only strip is named the same way the
// labelled one is.
const TAB_ICONS: Record<CaptureViewerTab, LucideIcon> = {
  screenshot: ImageIcon,
  page: FileCode,
  text: FileText,
  wayback: History
}

export function CaptureViewer() {
  const { caseId } = useParams({ from: '/cases/$caseId/captures' })
  const selectedCaptureId = useAppStore((s) => s.selectedCaptureId)
  const selectCapture = useAppStore((s) => s.selectCapture)
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))

  const activeTab = useAppStore((s) => s.activeViewerTab)
  const setActiveTab = useAppStore((s) => s.setActiveViewerTab)
  const capture = captures.find((item) => item.id === selectedCaptureId) ?? null

  // Determine content type based on active tab and capture format. Wayback
  // reads archive.org rather than an artifact, so it fetches nothing here.
  const contentType =
    activeTab === 'screenshot'
      ? 'png'
      : activeTab === 'page'
        ? 'html'
        : activeTab === 'text'
          ? 'txt'
          : null

  // Only fetch content if we have a capture and a content type. Page is excluded
  // for both formats now (#906): each renders its artifact in a guest that loads it
  // by file URL, so pulling the bytes across IPC as a string would be for nothing.
  const shouldFetchContent = selectedCaptureId && contentType && activeTab !== 'page'

  const { data: content } = useQuery({
    ...captureContentQueryOptions(selectedCaptureId || '', contentType || 'html'),
    enabled: !!shouldFetchContent
  })

  // Navigation walks the list as displayed: its narrowings and its sort. With
  // no list mounted (collapsed to the rail) nothing is narrowed on screen, so
  // the whole case is the list.
  const displayedCaptureIds = useAppStore((s) => s.displayedCaptureIds)
  const pagerIds = useMemo(
    () => displayedCaptureIds ?? captures.map((c) => c.id),
    [displayedCaptureIds, captures]
  )
  const currentIndex = selectedCaptureId ? pagerIds.indexOf(selectedCaptureId) : -1
  const goPrev = useCallback(() => {
    if (currentIndex > 0) selectCapture(pagerIds[currentIndex - 1])
  }, [currentIndex, pagerIds, selectCapture])
  const goNext = useCallback(() => {
    if (currentIndex < pagerIds.length - 1) selectCapture(pagerIds[currentIndex + 1])
  }, [currentIndex, pagerIds, selectCapture])

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
    if (captures.length === 0) return <main className="flex-1 bg-canvas" />
    return (
      <main className="flex flex-1 items-center justify-center bg-canvas text-text-muted">
        Select a capture to view
      </main>
    )
  }

  let hostname: string
  try {
    hostname = new URL(capture.url).hostname
  } catch {
    hostname = capture.url
  }

  const supersededOriginal = capture.supersedesCaptureId
    ? captures.find((c) => c.id === capture.supersedesCaptureId)
    : undefined
  const recaptureOf = captures.find((c) => c.supersedesCaptureId === capture.id)
  // Lenient like the recapture links above it: the source may have been
  // deleted, and the duplicate stays legible as a duplicate either way — the
  // badge comes from its own method, not from finding the row.
  const duplicateOf = capture.duplicateOfCaptureId
    ? captures.find((c) => c.id === capture.duplicateOfCaptureId)
    : undefined

  return (
    <main className="@container/viewer flex flex-1 flex-col overflow-hidden bg-canvas">
      {/* Merged viewer toolbar: breadcrumb + view switcher.

          Sized against the pane rather than the window (#466): the pane is what
          runs out of room, so a viewport breakpoint would still clip the
          controls whenever the details panel is docked. Below 36rem the tab
          labels give way to their icons; the Download label waits for 48rem,
          where the title has room beside it. The method badge comes back at
          42rem: on the Wayback tab the details panel that also carries the
          method is hidden, and at the default 1200px window that layout leaves
          the viewer 716px, so a 48rem tier would leave a background or
          duplicate capture reading as an ordinary one exactly where the
          operator has no other marker to check. The title is the only item
          here that flexes and the download error hangs below the trigger
          rather than sitting in the row, so from 340px up the tab strip, the
          download trigger and the pager all stay on screen. */}
      <div className="flex h-11 items-center gap-1.5 border-b border-border px-3 @xl/viewer:gap-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={() => useAppStore.getState().setSelectedCaptureId(null)}
          title="Back"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-medium text-text-primary">
            {capture.title || hostname}
          </span>
          {CAPTURE_METHOD_LABELS[capture.method] && (
            <span
              data-testid="method-badge"
              className="hidden shrink-0 rounded-lg bg-surface px-2 py-0.5 text-[11px] text-text-muted @2xl/viewer:inline-block"
            >
              {CAPTURE_METHOD_LABELS[capture.method]}
            </span>
          )}
          {duplicateOf && (
            <button
              data-testid="duplicate-link-source"
              className="min-w-0 truncate text-xs text-accent underline underline-offset-2"
              onClick={() => useAppStore.getState().setSelectedCaptureId(duplicateOf.id)}
            >
              ← Duplicate of {new Date(duplicateOf.timestamp).toLocaleString()}
            </button>
          )}
          {supersededOriginal && (
            <button
              data-testid="supersedes-link-original"
              className="min-w-0 truncate text-xs text-accent underline underline-offset-2"
              onClick={() => useAppStore.getState().setSelectedCaptureId(supersededOriginal.id)}
            >
              ← Recapture of {new Date(supersededOriginal.timestamp).toLocaleString()}
            </button>
          )}
          {recaptureOf && (
            <button
              data-testid="supersedes-link-recapture"
              className="min-w-0 truncate text-xs text-accent underline underline-offset-2"
              onClick={() => useAppStore.getState().setSelectedCaptureId(recaptureOf.id)}
            >
              Recaptured {new Date(recaptureOf.timestamp).toLocaleString()} →
            </button>
          )}
        </div>
        <div
          role="tablist"
          data-tour="viewertabs"
          className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5"
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab
            const Icon = TAB_ICONS[tab]
            return (
              <button
                key={tab}
                role="tab"
                aria-label={TAB_LABELS[tab]}
                title={TAB_LABELS[tab]}
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActiveTab(tab)}
                onKeyDown={(e) => {
                  const currentIndex = TABS.indexOf(tab)
                  let nextIndex = currentIndex
                  if (e.key === 'ArrowLeft') {
                    e.stopPropagation()
                    nextIndex = currentIndex > 0 ? currentIndex - 1 : TABS.length - 1
                  } else if (e.key === 'ArrowRight') {
                    e.stopPropagation()
                    nextIndex = currentIndex < TABS.length - 1 ? currentIndex + 1 : 0
                  } else if (e.key === 'Home') {
                    e.stopPropagation()
                    nextIndex = 0
                  } else if (e.key === 'End') {
                    e.stopPropagation()
                    nextIndex = TABS.length - 1
                  } else {
                    return
                  }
                  const nextTab = TABS[nextIndex]
                  setActiveTab(nextTab)
                  // Focus the new button after state update
                  requestAnimationFrame(() => {
                    const buttons = document.querySelectorAll('[role="tab"]')
                    ;(buttons[nextIndex] as HTMLButtonElement)?.focus()
                  })
                }}
                className={`flex items-center rounded-md px-1.5 py-1 text-[11px] transition-colors @xl/viewer:px-2.5 ${
                  isActive
                    ? 'bg-card font-semibold text-text-primary shadow-sm'
                    : 'font-medium text-text-muted hover:text-text-secondary'
                }`}
              >
                <Icon aria-hidden className="h-3.5 w-3.5 @xl/viewer:hidden" />
                <span className="hidden @xl/viewer:inline">{TAB_LABELS[tab]}</span>
              </button>
            )
          })}
        </div>
        <CaptureDownloadMenu capture={capture} />
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={goPrev}
          disabled={currentIndex <= 0}
          title="Previous capture (←)"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span data-testid="capture-pager-count" className="shrink-0 text-[11px] text-text-faint">
          {currentIndex + 1} / {pagerIds.length}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={goNext}
          disabled={currentIndex >= pagerIds.length - 1}
          title="Next capture (→)"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Content area — keep existing content branches except analysis */}
      <div className="flex-1 overflow-hidden min-h-0">
        <ErrorBoundary source="captureViewer">
          {activeTab === 'screenshot' &&
            (content ? (
              <ScreenshotTabPanel
                key={capture.id}
                captureId={capture.id}
                imageUrl={`data:image/png;base64,${content}`}
                url={capture.url}
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-1 p-8 text-center">
                <p className="text-sm text-text-muted">No screenshot available</p>
                <p className="text-xs text-text-faint">
                  Screenshot may not have been captured or exceeded the size limit.
                </p>
              </div>
            ))}
          {activeTab === 'page' ? (
            <div className="flex h-full w-full flex-col overflow-hidden">
              <ArchivedCopyBanner timestamp={capture.timestamp} />
              <div className="min-h-0 flex-1 overflow-hidden">
                {capture.format === 'mhtml' ? (
                  <MhtmlViewer captureId={capture.id} />
                ) : (
                  <LegacyHtmlViewer captureId={capture.id} />
                )}
              </div>
            </div>
          ) : null}
          {activeTab === 'wayback' && <WaybackCompare capture={capture} />}
          {activeTab === 'text' &&
            (content ? (
              <CaptureTextPanel
                key={capture.id}
                caseId={caseId}
                captureId={capture.id}
                heading={capture.title || hostname}
                content={content}
              />
            ) : (
              <div className="p-4 text-text-muted">No text content available</div>
            ))}
        </ErrorBoundary>
      </div>
    </main>
  )
}

/**
 * Says that the Page tab is a stored copy, and when it was taken (#704).
 *
 * The two claims are the two the tab cannot make for itself: the guest below
 * renders like a browser, so nothing on screen distinguishes an archived page
 * from a live one. Both hold for every format, which is why the copy does not
 * vary — a pre-v11 capture has no page.mhtml and the banner must not name one.
 *
 * Deliberately no more than that. Integrity is `ProvenanceBadge`'s to state and
 * the viewer's security posture is the viewer's, so neither can drift out of
 * step with this bar by being restated here.
 */
function ArchivedCopyBanner({ timestamp }: { timestamp: string }) {
  return (
    <div
      data-testid="archived-copy-banner"
      className="flex shrink-0 items-center gap-2.5 border-b border-border bg-surface px-3.5 py-1.5"
    >
      <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-500">
        <Archive className="h-2.5 w-2.5" strokeWidth={2.4} />
        Archived copy
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-text-muted">
        Captured {formatCaptureTimestampFull(timestamp)}
      </span>
    </div>
  )
}

function ScreenshotTabPanel({
  captureId,
  imageUrl,
  url
}: {
  captureId: string
  imageUrl: string
  url: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [container, setContainer] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [overlayVisible, setOverlayVisible] = useState(true)

  useEffect(() => {
    const img = new window.Image()
    img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = imageUrl
  }, [imageUrl])

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const ro = new ResizeObserver(() => {
      setContainer({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setContainer({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const editor = useAnnotationEditor({ initialShapes: [] })
  const zoomPan = useZoomPan({
    imageWidth: dims?.w ?? 0,
    imageHeight: dims?.h ?? 0,
    containerWidth: container.w,
    containerHeight: container.h
  })

  const drawing = editor.tool !== 'select' && editor.tool !== 'hand'

  const requestOverlayVisible = (next: boolean) => {
    if (drawing && !next) return
    setOverlayVisible(next)
  }

  useEffect(() => {
    if (drawing && !overlayVisible) setOverlayVisible(true)
  }, [drawing, overlayVisible])

  const cw = container.w
  const ch = container.h

  const zoomIn = () => zoomPan.zoomAt(1.25, cw / 2, ch / 2)
  const zoomOut = () => zoomPan.zoomAt(0.8, cw / 2, ch / 2)
  const fit = () => zoomPan.reset()
  const oneToOne = () => zoomPan.zoomAt(1 / zoomPan.fitScale / zoomPan.userScale, cw / 2, ch / 2)

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex-1 min-h-0 p-3">
        <BrowserChromeFrame url={url}>
          <div ref={containerRef} className="relative h-full w-full bg-canvas">
            {dims && container.w > 0 && (
              <AnnotationEditor
                key={captureId}
                captureId={captureId}
                imageUrl={imageUrl}
                imageWidth={dims.w}
                imageHeight={dims.h}
                containerWidth={container.w}
                containerHeight={container.h}
                editor={editor}
                zoomPan={zoomPan}
                overlayVisible={overlayVisible}
              />
            )}
            <CaptureViewerToolbar
              tool={editor.tool}
              setTool={editor.setTool}
              color={editor.color}
              setColor={editor.setColor}
              strokeWidth={editor.strokeWidth}
              setStrokeWidth={editor.setStrokeWidth}
              scale={zoomPan.scale}
              zoomIn={zoomIn}
              zoomOut={zoomOut}
              fit={fit}
              oneToOne={oneToOne}
              overlayVisible={overlayVisible}
              setOverlayVisible={requestOverlayVisible}
              canUndo={editor.canUndo}
              canRedo={editor.canRedo}
              onUndo={editor.undo}
              onRedo={editor.redo}
              selectedId={editor.selectedId}
              onDeleteSelected={() => {
                if (!editor.selectedId) return
                editor.removeShape(editor.selectedId)
              }}
            />
          </div>
        </BrowserChromeFrame>
      </div>
    </div>
  )
}
