import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import { capturesQueryOptions } from '@renderer/lib/queries'
import {
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Image,
  Globe,
  Code,
  FileText,
  ShieldCheck,
  Shield
} from 'lucide-react'
import { MhtmlViewer } from '@renderer/components/captures/MhtmlViewer'
import { AnnotationEditor } from './annotation/AnnotationEditor'
import { ForensicsTab } from './ForensicsTab'
import { CapturesGettingStarted } from './CapturesGettingStarted'
import { Button } from '@renderer/components/ui'
import { getProvenanceColor } from './getProvenanceColor'

type ViewTab = 'screenshot' | 'page' | 'source' | 'text' | 'forensics'

const TABS: ViewTab[] = ['screenshot', 'page', 'source', 'text', 'forensics']

const TAB_ICONS: Record<ViewTab, typeof Image> = {
  screenshot: Image,
  page: Globe,
  source: Code,
  text: FileText,
  forensics: ShieldCheck
}

const TAB_LABELS: Record<ViewTab, string> = {
  screenshot: 'Screenshot',
  page: 'Page',
  source: 'Source',
  text: 'Text',
  forensics: 'Forensics'
}

export function CaptureViewer() {
  const { caseId } = useParams({ from: '/cases/$caseId/captures' })
  const selectedCaptureId = useAppStore((s) => s.selectedCaptureId)
  const selectCapture = useAppStore((s) => s.selectCapture)
  const sessionActive = useAppStore((s) => s.sessionActive)
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))

  const [activeTab, setActiveTab] = useState<ViewTab>('screenshot')
  const [content, setContent] = useState<string | null>(null)
  const capture = captures.find((item) => item.id === selectedCaptureId) ?? null

  useEffect(() => {
    if (!selectedCaptureId) {
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
        <Button variant="ghost" size="icon-sm" onClick={goPrev} disabled={currentIndex <= 0}>
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
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <span className="shrink-0 text-[11px] text-text-faint">← →</span>
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
              captureId={capture.id}
              imageUrl={`data:image/png;base64,${content}`}
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
      </div>
    </main>
  )
}

function ScreenshotTabPanel({ captureId, imageUrl }: { captureId: string; imageUrl: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [container, setContainer] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

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

  return (
    <div ref={containerRef} className="flex h-full w-full">
      {dims && container.w > 0 && (
        <AnnotationEditor
          key={captureId}
          captureId={captureId}
          imageUrl={imageUrl}
          imageWidth={dims.w}
          imageHeight={dims.h}
          containerWidth={container.w}
          containerHeight={container.h}
        />
      )}
    </div>
  )
}
