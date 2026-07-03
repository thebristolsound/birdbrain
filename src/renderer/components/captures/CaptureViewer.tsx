import { useState, useCallback, useRef, useEffect } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import { capturesQueryOptions, captureContentQueryOptions } from '@renderer/lib/queries'
import {
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Image,
  Globe,
  Code,
  FileText,
  ShieldCheck,
  Shield,
  Archive
} from 'lucide-react'
import { MhtmlViewer } from '@renderer/components/captures/MhtmlViewer'
import { AnnotationEditor } from './annotation/AnnotationEditor'
import { ForensicsTab } from './ForensicsTab'
import { ArchiveTab } from './ArchiveTab'
import { CapturesGettingStarted } from './CapturesGettingStarted'
import { Button } from '@renderer/components/ui'
import { getProvenanceColor } from './getProvenanceColor'
import { CaptureViewerToolbar } from './CaptureViewerToolbar'
import { BrowserChromeFrame } from './BrowserChromeFrame'
import { AnnotationToolsTooltip } from './AnnotationToolsTooltip'
import { useAnnotationEditor } from './annotation/useAnnotationEditor'
import { useZoomPan } from './annotation/useZoomPan'

type ViewTab = 'screenshot' | 'page' | 'source' | 'text' | 'forensics' | 'archive'

const TABS: ViewTab[] = ['screenshot', 'page', 'source', 'text', 'forensics', 'archive']

const TAB_ICONS: Record<ViewTab, typeof Image> = {
  screenshot: Image,
  page: Globe,
  source: Code,
  text: FileText,
  forensics: ShieldCheck,
  archive: Archive
}

const TAB_LABELS: Record<ViewTab, string> = {
  screenshot: 'Screenshot',
  page: 'Page',
  source: 'Source',
  text: 'Text',
  forensics: 'Forensics',
  archive: 'Archive'
}

export function CaptureViewer() {
  const { caseId } = useParams({ from: '/cases/$caseId/captures' })
  const selectedCaptureId = useAppStore((s) => s.selectedCaptureId)
  const selectCapture = useAppStore((s) => s.selectCapture)
  const sessionActive = useAppStore((s) => s.sessionActive)
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))

  const [activeTab, setActiveTab] = useState<ViewTab>('screenshot')
  const capture = captures.find((item) => item.id === selectedCaptureId) ?? null

  // Determine content type based on active tab and capture format
  const contentType =
    activeTab === 'screenshot'
      ? 'png'
      : activeTab === 'page' || activeTab === 'source'
        ? 'html'
        : activeTab === 'text'
          ? 'txt'
          : null

  // Only fetch content if we have a capture, content type, and it's not MHTML page view
  const shouldFetchContent =
    selectedCaptureId &&
    contentType &&
    !(capture?.format === 'mhtml' && activeTab === 'page')

  const { data: content } = useQuery({
    ...captureContentQueryOptions(
      selectedCaptureId || '',
      contentType || 'html'
    ),
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

  return (
    <main className="flex flex-1 flex-col overflow-hidden bg-canvas">
      {/* Slim breadcrumb */}
      <div className="flex h-9 items-center gap-2 border-b border-border px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => useAppStore.getState().setSelectedCaptureId(null)}
          title="Back"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-medium text-text-primary">
            {capture.title || hostname}
          </span>
        </div>
        <Shield
          data-testid="capture-viewer-breadcrumb-provenance"
          className={`h-3.5 w-3.5 ${getProvenanceColor(capture.lastVerifiedStatus).text}`}
          aria-label={getProvenanceColor(capture.lastVerifiedStatus).label}
        />
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

      {/* Content area — keep existing content branches except analysis */}
      <div className="flex-1 overflow-hidden min-h-0">
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
        {activeTab === 'forensics' && <ForensicsTab capture={capture} caseId={caseId} />}
        {activeTab === 'archive' && <ArchiveTab capture={capture} />}
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
