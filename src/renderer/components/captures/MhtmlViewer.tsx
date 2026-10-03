import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { captureMhtmlUrlQueryOptions } from '@renderer/lib/queries'
import { useGuestFrameSize } from '@renderer/components/captures/useGuestFrameSize'
import { EntityContextMenu } from '@renderer/components/contextmenu/EntityContextMenu'
import { middleTruncate, readGuestContextMenu } from '@renderer/components/captures/guestLink'
import { useLinkMenuTarget, type LinkHit } from '@renderer/components/captures/useLinkMenuTarget'
import { MHTML_PARTITION } from '@shared/constants'

interface Props {
  captureId: string
  /** The viewed Capture's Case, where Capture link files and captured copies are found. */
  caseId: string
}

const NO_HIT: LinkHit = { linkUrl: '', linkText: '', imageUrl: '', selectionText: '' }

// Closes whichever entity menu is open. Radix's ContextMenu has no `open` prop, and
// its Escape listener is on the document, so a dispatched Escape is the close route.
function closeOpenMenu(): void {
  document
    .querySelector('[data-testid="entity-context-menu"]')
    ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

// Renders MHTML via an Electron <webview> with JavaScript disabled.
//
// Two surfaces mount it: the Page tab's mhtml branch in CaptureViewer, and the Wayback
// tab's stored-capture pane via CapturePane in WaybackCompare (asserted there by
// tests/components/WaybackCompare.test.tsx). A change to the frame or to the guest's
// posture here changes both, and the Wayback one sits beside a live archive.org guest
// still sized `100%` (#1126) — so the two panes of that comparison are not alike.
//
// Links in the guest are live to the pointer (#1708): hovering one shows its
// destination, and right-clicking opens the link menu. Following one is refused by
// the main process's navigation guard (decideFrameNavigation), not by anything here.
export function MhtmlViewer({ captureId, caseId }: Props) {
  const { data: fileUrl, error } = useQuery(captureMhtmlUrlQueryOptions(captureId))
  const ref = useRef<HTMLElement | null>(null)
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const opening = useRef(false)
  const frame = useGuestFrameSize()
  const [hoverUrl, setHoverUrl] = useState('')
  const [hit, setHit] = useState<LinkHit>(NO_HIT)
  const [frameChanged, setFrameChanged] = useState(false)
  const linkTarget = useLinkMenuTarget(caseId)

  useEffect(() => {
    const wv = ref.current as Electron.WebviewTag | null
    if (!wv) return
    setHoverUrl('')
    setFrameChanged(false)
    // The main process reports a stored iframe swapped for another document (it can
    // tell frames apart; this document cannot). A reload commits the main frame
    // again, which clears the notice.
    const stopFrameReplaced = window.birdbrain.onGuestFrameReplaced(({ guestWebContentsId }) => {
      if (wv.getWebContentsId() === guestWebContentsId) setFrameChanged(true)
    })
    const onMainCommit = () => setFrameChanged(false)
    const blockNav = (e: Event) => e.preventDefault()
    const onTargetUrl = (e: Event) => setHoverUrl((e as Electron.UpdateTargetUrlEvent).url ?? '')
    // Right-clicks inside the guest never reach this document, so the menu is opened
    // by hand: commit the new target first, synchronously, so the menu cannot open
    // with the previous right-click's target, then raise the event Radix opens on.
    // Electron reports the point in this window's coordinates, the guest's offset
    // already added, so it is used as it comes; the E2E spec pins the placement.
    const onContextMenu = (e: Event) => {
      e.preventDefault()
      const next = readGuestContextMenu(e)
      const trigger = triggerRef.current
      if (!next || !trigger) return
      flushSync(() => setHit(next))
      opening.current = true
      try {
        trigger.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            button: 2,
            clientX: next.x,
            clientY: next.y
          })
        )
      } finally {
        opening.current = false
      }
    }
    wv.addEventListener('will-navigate', blockNav)
    wv.addEventListener('new-window', blockNav)
    wv.addEventListener('update-target-url', onTargetUrl)
    wv.addEventListener('context-menu', onContextMenu)
    wv.addEventListener('focus', closeOpenMenu)
    wv.addEventListener('did-navigate', onMainCommit)
    return () => {
      wv.removeEventListener('will-navigate', blockNav)
      wv.removeEventListener('new-window', blockNav)
      wv.removeEventListener('update-target-url', onTargetUrl)
      wv.removeEventListener('context-menu', onContextMenu)
      wv.removeEventListener('focus', closeOpenMenu)
      wv.removeEventListener('did-navigate', onMainCommit)
      stopFrameReplaced()
    }
  }, [fileUrl])

  if (error) {
    return <div className="p-4 text-sm text-red-400">{String(error)}</div>
  }
  if (!fileUrl) {
    return <div className="p-4 text-text-muted">Loading MHTML...</div>
  }

  return (
    <EntityContextMenu target={linkTarget(hit)} className="h-full w-full" modal={false}>
      <div
        ref={triggerRef}
        className="relative h-full w-full"
        // A right-click on the pane around the guest has no link under it.
        onContextMenu={(e) => {
          if (!opening.current) e.preventDefault()
        }}
      >
        {/* The guest is sized to its layout viewport rather than to the pane, and the
            pane scrolls it — see useGuestFrameSize for why the two differ (#465).
            `min-*: 100%` does one thing only: it stops the element being smaller than
            the pane, so a window narrower than the pane leaves no strip of empty pane
            beside the page. It is not a fallback for a stale measurement — the guest
            lays out against the *current* window whatever size the element is, so an
            element read late still clips. */}
        <div data-testid="mhtml-viewer-scroll" className="h-full w-full overflow-auto">
          {/* Intentionally omit `nodeintegration` and `allowpopups` — both default to
              disabled in Electron, and passing them as string "false" historically
              *enabled* the features because HTML attribute presence = true. */}
          <webview
            data-testid="mhtml-viewer"
            ref={ref as unknown as React.RefObject<HTMLElement>}
            src={fileUrl}
            partition={MHTML_PARTITION}
            webpreferences="javascript=no,contextIsolation=yes,sandbox=yes"
            style={{
              width: `${frame.width}px`,
              height: `${frame.height}px`,
              minWidth: '100%',
              minHeight: '100%',
              background: 'white'
            }}
          />
        </div>
        {frameChanged && (
          <div
            role="status"
            data-testid="frame-changed-notice"
            className="absolute left-2 right-2 top-2 flex items-center gap-2 rounded-md border border-amber-500/30 bg-card px-3 py-1.5 text-xs text-text-secondary shadow-sm"
          >
            <span className="min-w-0 flex-1">
              A frame in this page changed after a click. Reload to restore the stored page.
            </span>
            <button
              type="button"
              className="shrink-0 rounded border border-border px-2 py-0.5 text-text-primary hover:bg-elevated"
              onClick={() => (ref.current as Electron.WebviewTag | null)?.reload()}
            >
              Reload
            </button>
          </div>
        )}
        {hoverUrl && (
          <div
            data-testid="link-status-bubble"
            title={hoverUrl}
            className="pointer-events-none absolute bottom-2 left-2 max-w-[80%] truncate rounded-md border border-border bg-card px-2 py-1 text-[11px] text-text-secondary shadow-sm"
          >
            {middleTruncate(hoverUrl, 120)}
          </div>
        )}
      </div>
    </EntityContextMenu>
  )
}
