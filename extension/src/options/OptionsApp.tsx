import { useCallback, useEffect, useState } from 'react'
import { BASE_URL, getStatus, getServerToken } from '@extension/utils/api'
import { openInApp } from '@extension/utils/appLink'
import { applyExtensionTheme } from '@extension/utils/theme'

// This page reads. It renders the connection, the pairing token and the app's
// screenshot setting, and it writes nothing back — every control the operator
// might expect to find here lives in the desktop app, which the footnote says.

const REFRESH_MS = 30_000

// Bullets, then the last four characters — enough to tell two tokens apart in a
// support thread without putting a working credential on screen.
const MASK_BULLETS = 20

type Phase = 'loading' | 'connected' | 'offline'

// ---------- Icons ----------
// Geometry mirrors the popup's own set (PopupApp.tsx) so the two extension
// surfaces draw the same shapes; the popup keeps its copies module-private.

const Lock = () => (
  <svg
    width={13}
    height={13}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="mt-px shrink-0 text-text-faint"
  >
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)

const Logo = () => (
  <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[5px] bg-accent">
    <svg
      className="h-[15px] w-[15px] text-white"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  </span>
)

// ---------- Copy, per state ----------
// The prototype draws only the connected, token-issued, screenshots-on case.
// The three below are the ones this page exists to explain, so each says what
// the operator does next rather than leaving a blank field.

function maskToken(token: string): string {
  return '•'.repeat(MASK_BULLETS) + token.slice(-4)
}

function connectionLabel(phase: Phase): { text: string; dot: string; tone: string } {
  if (phase === 'connected') {
    return { text: 'Connected', dot: 'bg-emerald-500', tone: 'text-emerald-500' }
  }
  if (phase === 'offline') {
    return { text: 'Not connected', dot: 'bg-text-faint', tone: 'text-text-muted' }
  }
  return { text: 'Checking', dot: 'bg-text-faint', tone: 'text-text-muted' }
}

function connectionNote(phase: Phase): string {
  if (phase === 'offline') {
    return 'Birdbrain is not running. Open the desktop app and this page reconnects on its own.'
  }
  return 'The desktop app must be running. Status refreshes every 30 seconds.'
}

function tokenValue(phase: Phase, token: string | null): string {
  if (token) return maskToken(token)
  if (phase === 'loading') return 'Reading from the app'
  if (phase === 'offline') return 'Unavailable while the app is closed'
  return 'Not issued yet'
}

function tokenNote(phase: Phase, token: string | null): string {
  if (phase === 'offline' && !token) {
    return 'Open the desktop app; the token is read back the next time this page reaches it.'
  }
  if (phase === 'connected' && !token) {
    return 'The app issues one automatically on first contact. Capture a page to trigger it.'
  }
  return 'Issued by the app automatically on first contact and stored in this browser.'
}

function screenshotPill(phase: Phase, captureScreenshots: boolean): { text: string; dot: string } {
  if (phase !== 'connected') return { text: 'Unknown', dot: 'bg-text-faint' }
  return captureScreenshots
    ? { text: 'On', dot: 'bg-emerald-500' }
    : { text: 'Off', dot: 'bg-text-faint' }
}

const SCREENSHOT_COPY =
  'Follows the capture setting in the app. MHTML and page text are always captured; very tall ' +
  'pages fall back to a viewport shot. Full-page and scrolling captures scroll the page while ' +
  'frames are taken — Birdbrain hides its own toast, highlights and overlays during the shot ' +
  'so they never appear in the evidence image.'

function screenshotNote(phase: Phase): string | null {
  if (phase !== 'offline') return null
  return 'Open the desktop app to see the setting that is actually in force.'
}

// ---------- Page ----------

export function OptionsPage() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [token, setToken] = useState<string | null>(null)
  const [captureScreenshots, setCaptureScreenshots] = useState(false)

  const version = chrome.runtime.getManifest().version

  const refresh = useCallback(async (): Promise<void> => {
    try {
      // getStatus first, always: getServerToken() reads a module cache that only
      // a status response fills, so reading it on mount returns null forever.
      // The case list is the one part of the payload this page never shows.
      const status = await getStatus({ includeCases: false })
      if (status.theme) applyExtensionTheme(status.theme)
      setCaptureScreenshots(status.captureScreenshots)
      setPhase(status.running ? 'connected' : 'offline')
      setToken(getServerToken())
    } catch {
      setPhase('offline')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const connection = connectionLabel(phase)
  const pill = screenshotPill(phase, captureScreenshots)
  const screenshotHint = screenshotNote(phase)

  return (
    <main className="mx-auto max-w-[520px] px-[26px] pt-10 pb-12 font-body">
      <div className="flex items-center gap-[10px]">
        <Logo />
        <div>
          <h1 className="font-display text-[15px] font-bold text-text-primary">Birdbrain</h1>
          <p className="text-[11px] text-text-muted">Extension options &middot; v{version}</p>
        </div>
      </div>

      <div className="mt-[22px] rounded-lg border border-border bg-card">
        <section className="border-b border-border px-4 py-[14px]">
          <h2 className="text-xs font-semibold text-text-primary">Connection</h2>
          <div className="mt-2 flex items-center gap-2">
            <span className="flex-1 rounded-md border border-border bg-canvas px-[10px] py-[6px] font-mono text-[11.5px] text-text-secondary">
              {BASE_URL}
            </span>
            <span
              role="status"
              className={`inline-flex items-center gap-[5px] text-[11px] ${connection.tone}`}
            >
              <span className={`h-[6px] w-[6px] rounded-full ${connection.dot}`} />
              {connection.text}
            </span>
          </div>
          <p className="mt-[6px] text-[10.5px] text-text-faint">{connectionNote(phase)}</p>
          <div className="mt-3 flex items-center gap-2">
            <span className="w-[82px] shrink-0 text-[11px] text-text-muted">Access token</span>
            <span className="flex-1 truncate font-mono text-[11px] text-text-faint">
              {tokenValue(phase, token)}
            </span>
          </div>
          <p className="mt-1 text-[10.5px] text-text-faint">{tokenNote(phase, token)}</p>
        </section>

        <section className="px-4 py-[14px]">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-text-primary">Screenshots</h2>
            <span className="inline-flex items-center gap-[5px] rounded-full border border-border px-[9px] py-[2px] text-[10.5px] font-semibold text-text-secondary">
              <span className={`h-[5px] w-[5px] rounded-full ${pill.dot}`} />
              {pill.text}
            </span>
          </div>
          <p className="mt-[5px] text-[10.5px] leading-[1.55] text-text-faint">{SCREENSHOT_COPY}</p>
          {screenshotHint && (
            <p className="mt-[5px] text-[10.5px] leading-[1.55] text-text-faint">
              {screenshotHint}
            </p>
          )}
        </section>
      </div>

      <div className="mt-3 flex gap-[9px] rounded-lg border border-border bg-canvas px-[14px] py-3">
        <Lock />
        <p className="text-[11px] leading-[1.55] text-text-muted">
          Cases, selectors, the ignore list and the dedupe window are managed in the Birdbrain app
          &mdash; the extension only ever holds the case you&apos;re working in.{' '}
          <button
            type="button"
            onClick={() => openInApp('settings')}
            className="cursor-pointer border-none bg-transparent p-0 font-body text-[11px] font-semibold text-accent hover:underline"
          >
            Open Birdbrain settings
          </button>
        </p>
      </div>
    </main>
  )
}
