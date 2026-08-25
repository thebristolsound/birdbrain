import { useEffect, useRef } from 'react'
import { WAYBACK_PARTITION, WAYBACK_REPLAY_PREFIX } from '@shared/constants'

interface Props {
  snapshotUrl: string
}

/**
 * The archive.org replay pane: remote, third-party content in an Electron
 * <webview> on its own session.
 *
 * The posture this element asks for is only half of it. The other half is enforced
 * in the main process, which is the half that matters — `will-attach-webview`
 * rewrites these preferences whatever the attribute says, refuses any `src` outside
 * the replay prefix, denies every permission and download on this partition, and
 * confines guest navigation to the same prefix (`src/main/webviewPolicy.ts`).
 *
 * JavaScript is deliberately ON here, unlike the MHTML evidence viewer: an
 * archive.org replay renders through its own scripts, and a scriptless pane would
 * misrepresent the archived page rather than reproduce it. Nothing in this pane is
 * evidence — it is fetched now, from a third party, and never stored.
 */
export function WaybackReplayView({ snapshotUrl }: Props) {
  const ref = useRef<HTMLElement | null>(null)

  // Renderer-side belt to the main process's braces: a guest that somehow reaches
  // for a new window gets nothing here either.
  useEffect(() => {
    const view = ref.current as Electron.WebviewTag | null
    if (!view) return
    const block = (e: Event): void => e.preventDefault()
    view.addEventListener('new-window', block)
    return () => view.removeEventListener('new-window', block)
  }, [snapshotUrl])

  if (!snapshotUrl.startsWith(WAYBACK_REPLAY_PREFIX)) {
    return (
      <div data-testid="wayback-replay-refused" className="p-4 text-xs text-red-400">
        This snapshot URL is not an archive.org replay address and was not loaded.
      </div>
    )
  }

  return (
    // `nodeintegration` and `allowpopups` are intentionally absent: an HTML
    // attribute counts as present whatever its value, so passing "false" would
    // enable them. The main process forces both off regardless.
    <webview
      key={snapshotUrl}
      ref={ref as unknown as React.RefObject<HTMLElement>}
      data-testid="wayback-replay-webview"
      src={snapshotUrl}
      partition={WAYBACK_PARTITION}
      webpreferences="contextIsolation=yes,sandbox=yes"
      style={{ width: '100%', height: '100%', background: 'white' }}
    />
  )
}
