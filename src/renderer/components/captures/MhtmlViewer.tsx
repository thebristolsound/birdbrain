import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { captureMhtmlUrlQueryOptions } from '@renderer/lib/queries'
import { capturesQueryOptions } from '@renderer/lib/api/captures'
import { useAppStore } from '@renderer/stores/appStore'
import { EntityContextMenu } from '@renderer/components/contextmenu/EntityContextMenu'
import {
  classifyGuestClick,
  linkClickOutcome,
  middleTruncate,
  readGuestContextMenu,
  type GuestPointer
} from '@renderer/components/captures/guestLink'
import { useLinkMenuTarget, type LinkHit } from '@renderer/components/captures/useLinkMenuTarget'
import { MHTML_PARTITION } from '@shared/constants'

interface Props {
  captureId: string
  /** The viewed Capture's Case, where Capture link files and captured copies are found. */
  caseId: string
  /**
   * Whether a click on a link moves the viewer to the Case's copy of it (#1735). Off
   * where moving the selection would swap out the page being compared.
   */
  linkClicks: boolean
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
// posture here changes both.
//
// The guest fills its pane, so the page lays out against the pane and reflows with it
// (#1941). e2e/page-tab-frame.spec.ts pins that from the guest's own layout viewport.
//
// Links in the guest are live to the pointer (#1708): hovering one shows its
// destination, and right-clicking opens the link menu. Following one is refused by
// the main process's navigation guard (decideFrameNavigation), not by anything here.
// A left click on a link in an embedded frame still replaces that frame with an empty
// document, as it did before #1735: nothing is fetched, and the frame-changed notice
// below offers a reload (e2e/mhtml-link-interactivity.spec.ts records each case). With
// `linkClicks` on, a left click on a link also selects the Case's Capture of it.
export function MhtmlViewer({ captureId, caseId, linkClicks }: Props) {
  const { data: fileUrl, error } = useQuery(captureMhtmlUrlQueryOptions(captureId))
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))
  const followCaptureLink = useAppStore((s) => s.followCaptureLink)
  const ref = useRef<HTMLElement | null>(null)
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const opening = useRef(false)
  // The hover destination and the last press, read by the press and release handlers.
  const hoverRef = useRef('')
  const pressRef = useRef<GuestPointer | null>(null)
  // The link a press and release named, until the guest's own attempt to follow a link
  // says which one it clicked.
  const clickedRef = useRef<string | null>(null)
  const [hoverUrl, setHoverUrl] = useState('')
  const [notInCase, setNotInCase] = useState<string | null>(null)
  const [hit, setHit] = useState<LinkHit>(NO_HIT)
  const [frameChanged, setFrameChanged] = useState(false)
  const linkTarget = useLinkMenuTarget(caseId)

  useEffect(() => {
    const wv = ref.current as Electron.WebviewTag | null
    if (!wv) return
    hoverRef.current = ''
    pressRef.current = null
    clickedRef.current = null
    setHoverUrl('')
    setNotInCase(null)
    setFrameChanged(false)
    // The main process reports a stored iframe swapped for another document (it can
    // tell frames apart; this document cannot). A reload commits the main frame
    // again, which clears the notice.
    const stopFrameReplaced = window.birdbrain.onGuestFrameReplaced(({ guestWebContentsId }) => {
      if (wv.getWebContentsId() === guestWebContentsId) setFrameChanged(true)
    })
    // A press in the guest closes the menu and the not-in-Case notice. Guest input never
    // reaches this document, so the main process reports it.
    const stopMouseDown = window.birdbrain.onGuestMouseDown(({ guestWebContentsId, button }) => {
      if (wv.getWebContentsId() !== guestWebContentsId) return
      closeOpenMenu()
      setNotInCase(null)
      pressRef.current = { url: hoverRef.current, button }
      clickedRef.current = null
    })
    const onMainCommit = () => setFrameChanged(false)
    const blockNav = (e: Event) => e.preventDefault()
    const onTargetUrl = (e: Event) => {
      hoverRef.current = (e as Electron.UpdateTargetUrlEvent).url ?? ''
      setHoverUrl(hoverRef.current)
    }
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
    wv.addEventListener('did-navigate', onMainCommit)
    return () => {
      wv.removeEventListener('will-navigate', blockNav)
      wv.removeEventListener('new-window', blockNav)
      wv.removeEventListener('update-target-url', onTargetUrl)
      wv.removeEventListener('context-menu', onContextMenu)
      wv.removeEventListener('did-navigate', onMainCommit)
      stopFrameReplaced()
      stopMouseDown()
    }
  }, [fileUrl])

  // A release pairs with the press before it. Its own effect, so that a change to the
  // Case's Captures re-subscribes it without resetting the guest's state above.
  //
  // The press and release can reach this document before the guest has handled the
  // move that preceded them, so the hover they read can be the link the pointer was on
  // before. The click is acted on only when the guest then tries to follow the same
  // link. A link the guest does not try to follow on a plain click (one that opens a
  // new window, say) does nothing here.
  useEffect(() => {
    const wv = ref.current as Electron.WebviewTag | null
    if (!wv || !linkClicks) return
    const stopMouseUp = window.birdbrain.onGuestMouseUp(
      ({ guestWebContentsId, button, modifiers }) => {
        if (wv.getWebContentsId() !== guestWebContentsId) return
        const press = pressRef.current
        pressRef.current = null
        clickedRef.current = classifyGuestClick(press, {
          url: hoverRef.current,
          button,
          modifiers
        })
      }
    )
    const onFollow = (e: Event) => {
      const { url } = e as Electron.DidStartNavigationEvent
      if (!url || url !== clickedRef.current) return
      clickedRef.current = null
      const viewed = captures.find(({ id }) => id === captureId)
      const outcome = linkClickOutcome(url, viewed, captures)
      if (outcome.kind === 'open') followCaptureLink(outcome.captureId)
      else if (outcome.kind === 'not-in-case') setNotInCase(outcome.url)
    }
    wv.addEventListener('did-start-navigation', onFollow)
    wv.addEventListener('will-frame-navigate', onFollow)
    return () => {
      stopMouseUp()
      wv.removeEventListener('did-start-navigation', onFollow)
      wv.removeEventListener('will-frame-navigate', onFollow)
    }
  }, [fileUrl, linkClicks, captures, captureId, followCaptureLink])

  const unheldTarget = notInCase ? linkTarget({ ...NO_HIT, linkUrl: notInCase }) : null

  if (error) {
    return <div className="p-4 text-sm text-danger-fg">{String(error)}</div>
  }
  if (!fileUrl) {
    return <div className="p-4 text-text-muted">Loading MHTML...</div>
  }

  return (
    <EntityContextMenu target={linkTarget(hit)} className="h-full w-full" modal={false}>
      <div
        ref={triggerRef}
        data-testid="mhtml-viewer-pane"
        className="relative h-full w-full"
        // A right-click on the pane around the guest has no link under it.
        onContextMenu={(e) => {
          if (!opening.current) e.preventDefault()
        }}
      >
        {/* Intentionally omit `nodeintegration` and `allowpopups` — both default to
            disabled in Electron, and passing them as string "false" historically
            *enabled* the features because HTML attribute presence = true. */}
        <webview
          data-testid="mhtml-viewer"
          ref={ref as unknown as React.RefObject<HTMLElement>}
          src={fileUrl}
          partition={MHTML_PARTITION}
          webpreferences="javascript=no,contextIsolation=yes,sandbox=yes"
          style={{ width: '100%', height: '100%', background: 'white' }}
        />
        {frameChanged && (
          <div
            role="status"
            data-testid="frame-changed-notice"
            className="absolute left-2 right-2 top-2 flex items-center gap-2 rounded-md border border-amber-500/30 bg-card px-3 py-1.5 text-xs text-text-secondary shadow-sm"
          >
            <span className="min-w-0 flex-1">
              A frame in this page changed after it loaded. Reload to restore the stored page.
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
        {unheldTarget ? (
          <div
            role="status"
            data-testid="link-not-in-case"
            className="absolute bottom-2 left-2 flex max-w-[80%] items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-text-secondary shadow-sm"
          >
            <span className="shrink-0 font-semibold text-text-primary">Not in this Case</span>
            <span className="min-w-0 truncate" title={unheldTarget.linkUrl}>
              {middleTruncate(unheldTarget.linkUrl, 80)}
            </span>
            <button
              type="button"
              disabled={unheldTarget.captureBlockedReason !== null}
              className="shrink-0 rounded border border-border px-2 py-0.5 text-text-primary hover:bg-elevated disabled:opacity-50"
              onClick={unheldTarget.actions.captureLink}
            >
              {unheldTarget.captureBlockedReason
                ? `Capture link (${unheldTarget.captureBlockedReason})`
                : 'Capture link'}
            </button>
          </div>
        ) : (
          hoverUrl && (
            <div
              data-testid="link-status-bubble"
              title={hoverUrl}
              className="pointer-events-none absolute bottom-2 left-2 max-w-[80%] truncate rounded-md border border-border bg-card px-2 py-1 text-[11px] text-text-secondary shadow-sm"
            >
              {middleTruncate(hoverUrl, 120)}
            </div>
          )
        )}
      </div>
    </EntityContextMenu>
  )
}
