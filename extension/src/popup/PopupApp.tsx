import { useCallback, useEffect, useRef, useState } from 'react'
import { getStatus, getCases, activateCase, stopSession } from '@extension/utils/api'
import { openInApp } from '@extension/utils/appLink'
import { applyExtensionTheme } from '@extension/utils/theme'
import type { CaptureServerCase, CaptureServerCaseRef } from '@shared/schemas'
import type { ManualCaptureResponse, PopupPageStatus } from '@extension/messages'
import { derivePageStatus, deriveMatchSummary } from '@extension/popup/pageStatus'

function currentTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]))
  })
}

// The popup asks the background for everything it cannot know itself. A service
// worker that is starting up (or gone) answers with lastError rather than a
// value; reading it is what stops Chrome logging the unchecked-error warning,
// and the null it resolves to is the popup's cue to show neutral copy.
function askBackground<T>(message: Record<string, unknown>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response: unknown) => {
        void chrome.runtime.lastError
        resolve((response as T | undefined) ?? null)
      })
    } catch {
      resolve(null)
    }
  })
}

const POLL_WHILE_CAPTURING_MS = 800

// ---------- Icons ----------
// Geometry copied from the prototype's symbol set so the popup and the app
// draw the same shapes at the same stroke weight.

function Icon({
  size,
  strokeWidth = 2,
  className,
  children
}: {
  size: number
  strokeWidth?: number
  className?: string
  children: React.ReactNode
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  )
}

const ChevronDown = ({ className }: { className?: string }) => (
  <Icon size={11} className={className}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
)

const Check = ({ className }: { className?: string }) => (
  <Icon size={11} strokeWidth={2.6} className={className}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
)

const Clock = ({ className }: { className?: string }) => (
  <Icon size={13} strokeWidth={2.2} className={className}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </Icon>
)

const CheckCircle = ({ className }: { className?: string }) => (
  <Icon size={13} strokeWidth={2.2} className={className}>
    <path d="M21.801 10A10 10 0 1 1 17 3.335" />
    <path d="m9 11 3 3L22 4" />
  </Icon>
)

const Ban = ({ className }: { className?: string }) => (
  <Icon size={13} strokeWidth={2.2} className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="m4.9 4.9 14.2 14.2" />
  </Icon>
)

const Lock = ({ className }: { className?: string }) => (
  <Icon size={12} className={className}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Icon>
)

const ShieldAlert = ({ className }: { className?: string }) => (
  <Icon size={14} strokeWidth={2.2} className={className}>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </Icon>
)

const Gear = ({ className }: { className?: string }) => (
  <Icon size={12} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Icon>
)

const Logo = () => (
  <img src="/icons/icon-48.png" alt="" className="h-[21px] w-[21px] shrink-0 rounded" />
)

const CASE_COLORS = { crypto: '#f59e0b', malware: '#0ea5e9', fraud: '#ec4899', custom: '#94a3b8' }

// ---------- Chrome ----------

type ConnectionState = 'offline' | 'nocase' | 'recording' | 'connected'

const DOT: Record<ConnectionState, { label: string; className: string }> = {
  offline: { label: 'Offline', className: 'bg-text-faint' },
  nocase: { label: 'No case', className: 'bg-amber-500' },
  recording: { label: 'Recording', className: 'bg-red-500 status-recording' },
  connected: { label: 'Connected', className: 'bg-emerald-500' }
}

function Shell({ state, children }: { state: ConnectionState; children: React.ReactNode }) {
  const { label, className } = DOT[state]
  return (
    <div className="flex w-[320px] flex-col bg-canvas font-body text-text-primary">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-[13px] py-[10px]">
        <div className="flex min-w-0 items-center gap-2">
          <Logo />
          <span className="font-display text-xs font-bold text-text-primary">Birdbrain</span>
        </div>
        <span
          role="status"
          title={label}
          aria-label={label}
          className={`h-[7px] w-[7px] shrink-0 rounded-full ${className}`}
        />
      </header>
      {children}
    </div>
  )
}

function Footer({ version }: { version: string }) {
  return (
    <div className="flex shrink-0 items-center justify-between border-t border-border bg-canvas px-[13px] py-[7px]">
      <button
        type="button"
        onClick={() => openInApp('open')}
        className="cursor-pointer border-none bg-transparent p-0 font-body text-[11px] text-text-muted hover:text-text-primary"
      >
        Open in Birdbrain
      </button>
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            void chrome.runtime.openOptionsPage()
          }}
          title="Extension options"
          aria-label="Extension options"
          className="flex h-5 w-5 cursor-pointer items-center justify-center rounded border-none bg-transparent text-text-faint hover:bg-surface hover:text-text-secondary"
        >
          <Gear />
        </button>
        <span className="text-[10px] text-text-faint">v{version}</span>
      </span>
    </div>
  )
}

// ---------- Case menu ----------

function CaseMenu({
  cases,
  activeCaseId,
  role,
  footnote,
  onPick,
  className
}: {
  cases: CaptureServerCase[]
  activeCaseId: string | null
  role: 'menu' | 'listbox'
  footnote: string
  onPick: (id: string) => void
  className: string
}) {
  const itemsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const first = itemsRef.current?.querySelector<HTMLButtonElement>('button')
    first?.focus()
  }, [])

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const buttons = Array.from(itemsRef.current?.querySelectorAll('button') ?? [])
    if (buttons.length === 0) return
    event.preventDefault()
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    const next = (at + step + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  return (
    <div
      role={role}
      ref={itemsRef}
      onKeyDown={handleKeyDown}
      className={`pop absolute top-full z-40 mt-1 rounded-md border border-border-strong bg-card py-1 shadow-overlay ${className}`}
    >
      <div className="px-3 pb-1 pt-[5px] text-[10px] font-semibold uppercase tracking-[0.05em] text-text-faint">
        Set active case
      </div>
      {cases.map((entry) => {
        const current = entry.id === activeCaseId
        return (
          <button
            key={entry.id}
            type="button"
            role={role === 'menu' ? 'menuitem' : 'option'}
            aria-selected={role === 'listbox' ? current : undefined}
            onClick={() => onPick(entry.id)}
            className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left font-body hover:bg-surface"
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: CASE_COLORS[entry.type ?? 'custom'] }}
            />
            <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
              {entry.name}
            </span>
            {current && <Check className="shrink-0 text-accent" />}
          </button>
        )
      })}
      <div className="mt-[3px] border-t border-border px-3 pb-1 pt-1.5 text-[10px] leading-[1.5] text-text-faint">
        {footnote}
      </div>
    </div>
  )
}

// ---------- Popup ----------

export function Popup(): React.JSX.Element {
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [sessionActive, setSessionActive] = useState(false)
  const [activeCase, setActiveCase] = useState<CaptureServerCaseRef | null>(null)
  const [cases, setCases] = useState<CaptureServerCase[]>([])
  const [pageStatus, setPageStatus] = useState<PopupPageStatus | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const menuRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const version = chrome.runtime.getManifest().version

  const refreshPageStatus = useCallback(async (): Promise<void> => {
    const tab = await currentTab()
    setNow(Date.now())
    if (tab?.id === undefined) {
      setPageStatus(null)
      return
    }
    setPageStatus(await askBackground<PopupPageStatus>({ type: 'GET_PAGE_STATUS', tabId: tab.id }))
  }, [])

  const checkStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await getStatus()
      setConnected(status.running)
      if (status.theme) applyExtensionTheme(status.theme)
      setSessionActive(status.sessionActive)
      setActiveCase(status.activeCase)
      if (status.running) {
        setCases(await getCases())
        await refreshPageStatus()
      }
    } catch {
      setConnected(false)
    } finally {
      setLoading(false)
    }
  }, [refreshPageStatus])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  // A capture in flight is the one thing that changes without the operator
  // touching the popup, so it is also the only thing worth polling for.
  const capturing = pageStatus?.capturing ?? false
  useEffect(() => {
    if (!capturing) return
    const timer = setInterval(() => {
      refreshPageStatus()
    }, POLL_WHILE_CAPTURING_MS)
    return () => clearInterval(timer)
  }, [capturing, refreshPageStatus])

  const lastCapturedAt = pageStatus?.lastCapture?.at
  useEffect(() => {
    if (lastCapturedAt == null) return
    const delay = lastCapturedAt + 60_000 - Date.now()
    if (delay <= 0) return
    const timer = setTimeout(() => setNow(Date.now()), delay)
    return () => clearTimeout(timer)
  }, [lastCapturedAt])

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(event: MouseEvent): void {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  async function handlePickCase(id: string): Promise<void> {
    setMenuOpen(false)
    const result = await activateCase(id)
    setActiveCase(result.case)
    // Selectors and the background's cached match summary follow the active
    // case, so the background is told to re-poll before the page status is
    // re-read — otherwise the popup shows the previous case's counts until the
    // 30 s status alarm catches up.
    await askBackground({ type: 'CASE_ACTIVATED' })
    await refreshPageStatus()
  }

  async function handleStopSession(): Promise<void> {
    try {
      if (capturing) {
        const tab = await currentTab()
        const reply = await askBackground<{ message: string }>({
          type: 'STOP_CAPTURE',
          tabId: tab?.id
        })
        if (reply) setBlockedNotice(reply.message)
      }
      await stopSession()
      setSessionActive(false)
      chrome.runtime.sendMessage({ type: 'SESSION_STOPPED' })
    } catch {
      setBlockedNotice('Could not stop the session. Try again.')
    }
  }

  async function handleCaptureNow(): Promise<void> {
    if (!activeCase || capturing) return
    setBlockedNotice(null)
    const tab = await currentTab()
    if (tab?.id === undefined) return
    // The background owns the decision: it re-reads the tab's URL and runs the
    // same ignore rules the context-menu route runs, so the popup never matches
    // patterns itself and a capture it cannot make is never sent.
    const response = await askBackground<ManualCaptureResponse>({
      type: 'MANUAL_CAPTURE',
      tabId: tab.id,
      caseId: activeCase.id
    })
    if (!response) {
      setBlockedNotice('Not captured — Birdbrain did not answer. Try again.')
    } else if (response.notReady) {
      setBlockedNotice('Not captured — still loading your ignore rules. Try again in a moment.')
    } else if (response.blocked) {
      setBlockedNotice(
        response.blocked.reason === 'user' && response.blocked.pattern
          ? `Not captured — ignored by your rule: ${response.blocked.pattern}`
          : "Not captured — this page can't be captured."
      )
    } else if (!response.started) {
      setBlockedNotice('Not captured — this tab has no page to capture.')
    }
    await refreshPageStatus()
  }

  if (loading) {
    return (
      <div className="flex w-[320px] flex-col items-center justify-center bg-canvas py-16 font-body">
        <span className="animate-pulse">
          <Logo />
        </span>
        <span className="sr-only">Connecting to Birdbrain</span>
      </div>
    )
  }

  if (!connected) {
    return (
      <Shell state="offline">
        <div className="min-h-0 flex-1 px-[13px] py-[15px]">
          <div className="flex items-center gap-[7px]">
            <ShieldAlert className="shrink-0 text-red-400" />
            <span className="text-xs font-semibold text-text-primary">
              Birdbrain isn&apos;t running
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-[1.5] text-text-muted">
            Nothing on this page is being captured. Open the desktop app and this reconnects on its
            own.
          </p>
          <button
            type="button"
            onClick={checkStatus}
            className="mt-[11px] h-7 w-full cursor-pointer rounded border-none bg-accent font-body text-xs font-semibold text-white hover:bg-accent-hover"
          >
            Retry connection
          </button>
        </div>
        <Footer version={version} />
      </Shell>
    )
  }

  if (!activeCase) {
    return (
      <Shell state="nocase">
        <div className="min-h-0 flex-1 px-[13px] py-[15px]">
          <div className="text-xs font-semibold text-text-primary">No case selected</div>
          <p className="mt-[3px] text-[11px] leading-[1.5] text-text-muted">
            Nothing on this page is being logged until you pick a case.
          </p>
          {cases.length === 0 ? (
            <p className="mt-[11px] text-[11px] leading-[1.5] text-text-faint">
              No cases yet — create one in the Birdbrain app.
            </p>
          ) : (
            <div className="relative mt-[11px]" ref={menuRef}>
              <button
                type="button"
                ref={triggerRef}
                onClick={() => setMenuOpen((open) => !open)}
                aria-haspopup="listbox"
                aria-expanded={menuOpen}
                className="flex h-7 w-full cursor-pointer items-center gap-2 rounded border border-border-strong bg-canvas px-[10px] font-body hover:border-text-faint"
              >
                <span className="min-w-0 flex-1 truncate text-left text-xs text-text-muted">
                  Select a case…
                </span>
                <ChevronDown className="shrink-0 text-text-muted" />
              </button>
              {menuOpen && (
                <CaseMenu
                  cases={cases}
                  activeCaseId={null}
                  role="listbox"
                  footnote="One active case — picking here switches the Birdbrain app too."
                  onPick={handlePickCase}
                  className="left-0 right-0"
                />
              )}
            </div>
          )}
          <div className="mt-[9px] flex items-start gap-[7px] rounded-md border border-border bg-canvas px-[10px] py-2">
            <Lock className="mt-px shrink-0 text-text-faint" />
            <span className="text-[11px] leading-[1.5] text-text-faint">
              Nothing you capture or select leaves Birdbrain. The extension reads your case list so
              you can pick one here, and sends captures only to the app on this machine.
            </span>
          </div>
        </div>
        <Footer version={version} />
      </Shell>
    )
  }

  const status = derivePageStatus(pageStatus, now)
  const matchSummary = deriveMatchSummary(pageStatus)
  // `rulesLoaded` is part of the condition, not a detail: until the operator's
  // ignore rules reach the worker, `blocked === null` only means the empty list
  // matched nothing.
  const capturable =
    pageStatus !== null &&
    pageStatus.url !== null &&
    pageStatus.rulesLoaded &&
    pageStatus.blocked === null
  const justCaptured = pageStatus?.lastCapture != null && now - pageStatus.lastCapture.at < 60_000
  const StatusIcon =
    status.tone === 'captured' ? CheckCircle : status.tone === 'blocked' ? Ban : Clock

  return (
    <Shell state={sessionActive ? 'recording' : 'connected'}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-[13px] py-[9px]">
        <div className="relative min-w-0" ref={menuRef}>
          <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-text-faint">
            Logging to
          </div>
          <button
            type="button"
            ref={triggerRef}
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="mt-0.5 flex max-w-full cursor-pointer items-center gap-[5px] border-none bg-transparent p-0 font-body"
          >
            <span className="truncate text-xs font-semibold text-text-primary">
              {activeCase.name}
            </span>
            <ChevronDown className="shrink-0 text-text-muted" />
          </button>
          {menuOpen && (
            <CaseMenu
              cases={cases}
              activeCaseId={activeCase.id}
              role="menu"
              footnote="One active case — switching here switches the Birdbrain app too."
              onPick={handlePickCase}
              className="left-0 w-[228px]"
            />
          )}
        </div>
        <button
          type="button"
          onClick={() => openInApp('open')}
          title="Open Birdbrain"
          className="shrink-0 cursor-pointer border-none bg-transparent p-0 font-body text-[11px] font-semibold text-accent hover:text-accent-hover"
        >
          Switch in app
        </button>
      </div>

      <div className="min-h-0 flex-1 px-[13px] py-[11px]">
        <div className="flex items-center gap-[7px]">
          <StatusIcon className="shrink-0 text-text-faint" />
          <span className="text-xs font-semibold text-text-primary">{status.text}</span>
        </div>
        <div className="mt-[3px] break-words pl-5 text-[11px] text-text-muted">{status.sub}</div>
        {matchSummary && (
          <div className="mt-3 border-t border-border pt-[9px] text-[11px] text-text-muted">
            {matchSummary}
          </div>
        )}
        <p className="mt-2 text-[11px] leading-[1.6] text-text-faint">
          Right-click the page to capture — full page or scrolling — or right-click selected text to
          create a selector.
        </p>
        {blockedNotice && (
          <p role="alert" className="mt-2 break-words text-[11px] leading-[1.5] text-amber-500">
            {blockedNotice}
          </p>
        )}
      </div>

      <div className="flex shrink-0 gap-[7px] border-t border-border px-[13px] py-[10px]">
        <button
          type="button"
          onClick={handleStopSession}
          className="h-7 flex-1 cursor-pointer rounded border border-red-500/35 bg-transparent font-body text-xs font-semibold text-red-400 hover:bg-red-500/10"
        >
          {capturing ? 'Stop capture' : 'Stop session'}
        </button>
        {capturable && !capturing && !justCaptured && (
          <button
            type="button"
            onClick={handleCaptureNow}
            className="h-7 shrink-0 cursor-pointer rounded border border-border-strong bg-transparent px-3 font-body text-xs font-medium text-text-primary hover:bg-surface"
          >
            Capture now
          </button>
        )}
      </div>

      <Footer version={version} />
    </Shell>
  )
}
