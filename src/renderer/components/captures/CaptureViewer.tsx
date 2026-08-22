import { useState, useCallback, useRef, useEffect } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAppStore, type CaptureViewerTab } from '@renderer/stores/appStore'
import { capturesQueryOptions, captureContentQueryOptions } from '@renderer/lib/queries'
import { ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react'
import { MhtmlViewer } from '@renderer/components/captures/MhtmlViewer'
import { AnnotationEditor } from '@renderer/components/captures/annotation/AnnotationEditor'
import { CapturesGettingStarted } from '@renderer/components/captures/CapturesGettingStarted'
import { Button } from '@renderer/components/ui'
import { CaptureViewerToolbar } from '@renderer/components/captures/CaptureViewerToolbar'
import { CaptureDownloadMenu } from '@renderer/components/captures/CaptureDownloadMenu'
import { BrowserChromeFrame } from '@renderer/components/captures/BrowserChromeFrame'
import { AnnotationToolsTooltip } from '@renderer/components/captures/AnnotationToolsTooltip'
import { WaybackTab } from '@renderer/components/captures/WaybackTab'
import { useAnnotationEditor } from '@renderer/components/captures/annotation/useAnnotationEditor'
import { useZoomPan } from '@renderer/components/captures/annotation/useZoomPan'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'

// Source is gone: Page *is* the MHTML, so the two tabs rendered the same
// artifact twice. The raw file is still one click away in the download menu.
const TABS: CaptureViewerTab[] = ['screenshot', 'page', 'text', 'wayback']

const TAB_LABELS: Record<CaptureViewerTab, string> = {
  screenshot: 'Screenshot',
  page: 'Page',
  text: 'Text',
  wayback: 'Wayback'
}

export function CaptureViewer() {
  const { caseId } = useParams({ from: '/cases/$caseId/captures' })
  const selectedCaptureId = useAppStore((s) => s.selectedCaptureId)
  const selectCapture = useAppStore((s) => s.selectCapture)
  const sessionActive = useAppStore((s) => s.sessionActive)
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

  // Only fetch content if we have a capture, content type, and it's not MHTML page view
  const shouldFetchContent =
    selectedCaptureId && contentType && !(capture?.format === 'mhtml' && activeTab === 'page')

  const { data: content } = useQuery({
    ...captureContentQueryOptions(selectedCaptureId || '', contentType || 'html'),
    enabled: !!shouldFetchContent
  })

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
    if (captures.length === 0 && !sessionActive) {
      return <CapturesGettingStarted />
    }
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

  const supersededOriginal = capture.supersedesCaptureId
    ? captures.find((c) => c.id === capture.supersedesCaptureId)
    : undefined
  const recaptureOf = captures.find((c) => c.supersedesCaptureId === capture.id)

  return (
    <main className="flex flex-1 flex-col overflow-hidden bg-canvas">
      {/* Merged viewer toolbar: breadcrumb + view switcher */}
      <div className="flex h-11 items-center gap-2.5 border-b border-border px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => useAppStore.getState().setSelectedCaptureId(null)}
          title="Back"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-medium text-text-primary">
            {capture.title || hostname}
          </span>
          {capture.method === 'background' && (
            <span
              data-testid="method-badge"
              className="shrink-0 rounded-lg bg-surface px-2 py-0.5 text-[11px] text-text-muted"
            >
              Background
            </span>
          )}
          {supersededOriginal && (
            <button
              data-testid="supersedes-link-original"
              className="shrink-0 truncate text-xs text-accent underline underline-offset-2"
              onClick={() => useAppStore.getState().setSelectedCaptureId(supersededOriginal.id)}
            >
              ← Recapture of {new Date(supersededOriginal.timestamp).toLocaleString()}
            </button>
          )}
          {recaptureOf && (
            <button
              data-testid="supersedes-link-recapture"
              className="shrink-0 truncate text-xs text-accent underline underline-offset-2"
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
            return (
              <button
                key={tab}
                role="tab"
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
                className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                  isActive
                    ? 'bg-card font-semibold text-text-primary shadow-sm'
                    : 'font-medium text-text-muted hover:text-text-secondary'
                }`}
              >
                {TAB_LABELS[tab]}
              </button>
            )
          })}
        </div>
        <CaptureDownloadMenu capture={capture} />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={goPrev}
          disabled={currentIndex <= 0}
          title="Previous capture (←)"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="shrink-0 text-[11px] text-text-faint">
          {currentIndex + 1} / {captures.length}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={goNext}
          disabled={currentIndex >= captures.length - 1}
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
          {activeTab === 'wayback' && <WaybackTab capture={capture} />}
          {activeTab === 'text' &&
            (content ? (
              <div className="h-full overflow-y-auto p-4">
                <pre className="whitespace-pre-wrap font-mono text-sm text-text-muted">
                  {content}
                </pre>
              </div>
            ) : (
              <div className="p-4 text-text-muted">No text content available</div>
            ))}
        </ErrorBoundary>
      </div>
    </main>
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
            <AnnotationToolsTooltip />
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
