import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { getStatus, getCases, activateCase, stopSession } from '@extension/utils/api'
import type { CaptureServerCase } from '@shared/schemas'
import './popup.css'

// Hand off to the desktop app via its registered birdbrain:// scheme. Opening a
// tab lets Chrome surface the external-protocol prompt and launch/focus the app;
// the app routes the renderer based on the host segment (open | settings).
function openInApp(target: 'open' | 'settings') {
  chrome.tabs.create({ url: `birdbrain://${target}` })
}

function applyPopupTheme(theme: 'light' | 'dark'): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem('bb-theme', theme)
  } catch {
    //
  }
}

// ---------- Header ----------

function Header() {
  const handleClose = () => window.close()

  return (
    <header className="flex items-center justify-between px-4 h-12 sticky top-0 z-10 bg-surface border-b border-border">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-accent flex items-center justify-center">
          <svg
            className="w-3 h-3 text-white"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="12" r="2" />
            <line x1="12" y1="2" x2="12" y2="4" />
            <line x1="12" y1="20" x2="12" y2="22" />
            <line x1="2" y1="12" x2="4" y2="12" />
            <line x1="20" y1="12" x2="22" y2="12" />
          </svg>
        </div>
        <span className="font-display font-extrabold text-sm tracking-tight text-text-primary">
          Birdbrain
        </span>
      </div>
      <button
        onClick={handleClose}
        aria-label="Close popup"
        className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
      >
        <svg
          className="w-4 h-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </header>
  )
}

// ---------- Status Card ----------

function StatusCard({
  sessionActive,
  activeCase,
  currentDomain
}: {
  sessionActive: boolean
  activeCase: { id: string; name: string } | null
  currentDomain: string
}) {
  return (
    <section className="animate-fade-up rounded-xl p-4 bg-card border border-border">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
          Capture Status
        </span>
        {sessionActive ? (
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-500/15 border border-red-500/25">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 status-recording" />
            <span className="text-[10px] font-bold text-red-400">Recording</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-[10px] font-bold text-emerald-400">Connected</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-surface border border-border text-text-muted">
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        </div>
        <div className="min-w-0">
          <h3 className="text-xs font-bold truncate text-text-primary">
            {currentDomain || 'No active tab'}
          </h3>
          <p className="text-[10px] truncate text-text-muted">
            {activeCase ? `Session: ${activeCase.name}` : 'No case selected'}
          </p>
        </div>
      </div>
    </section>
  )
}

// ---------- Stats Grid ----------

function StatsGrid({
  captureCount,
  selectorCount
}: {
  captureCount: number
  selectorCount: number
}) {
  return (
    <section className="animate-fade-up-delay-1 grid grid-cols-2 gap-3">
      <div className="rounded-xl p-3 bg-card border border-border">
        <span className="text-[9px] font-bold uppercase block mb-1 text-text-muted">
          Captures
        </span>
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-display font-extrabold text-accent">
            {captureCount}
          </span>
          <span className="text-[10px] text-text-muted">active</span>
        </div>
      </div>
      <div className="rounded-xl p-3 bg-card border border-border">
        <span className="text-[9px] font-bold uppercase block mb-1 text-text-muted">
          Selectors
        </span>
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-display font-extrabold text-text-primary">
            {selectorCount}
          </span>
          <span className="text-[10px] text-text-muted">matching</span>
        </div>
      </div>
    </section>
  )
}

// ---------- Footer ----------

function Footer({
  sessionActive,
  activeCase,
  onStopCapture,
  onManualCapture,
  capturing
}: {
  sessionActive: boolean
  activeCase: { id: string; name: string } | null
  onStopCapture: () => void
  onManualCapture: () => void
  capturing: boolean
}) {
  return (
    <footer className="p-4 mt-auto bg-surface border-t border-border">
      <div className="flex gap-2 items-center">
        {/* HOTFIX: Start Capture removed while auto-capture is disabled; Stop remains so an
            already-recording session can still be ended */}
        {sessionActive && (
          <button
            onClick={onStopCapture}
            className="flex-1 h-10 flex items-center justify-center gap-2 rounded-md font-display font-bold text-xs active:scale-[0.98] transition-all bg-red-600 hover:bg-red-500 text-white"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
            Stop Capture
          </button>
        )}

        {activeCase && (
          <button
            onClick={onManualCapture}
            disabled={capturing}
            className="w-10 h-10 flex items-center justify-center rounded-md active:scale-[0.98] transition-colors bg-surface border border-border text-text-secondary hover:bg-elevated hover:text-text-primary disabled:opacity-40"
            title="Capture this page"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </button>
        )}

        <button
          onClick={() => openInApp('settings')}
          className="w-10 h-10 flex items-center justify-center rounded-md active:scale-[0.98] transition-colors bg-surface border border-border text-text-secondary hover:bg-elevated hover:text-text-primary"
          title="Settings"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      <div className="mt-3 text-center">
        <button
          onClick={() => openInApp('open')}
          className="text-[10px] font-bold uppercase tracking-widest text-accent hover:text-accent-hover transition-colors"
        >
          Open Full Workspace
        </button>
      </div>
    </footer>
  )
}

// ---------- Case Selector ----------

function CaseSelector({
  cases,
  activeCase,
  onSelect
}: {
  cases: CaptureServerCase[]
  activeCase: { id: string; name: string } | null
  onSelect: (id: string) => void
}) {
  if (cases.length === 0) {
    return (
      <section className="animate-fade-up rounded-xl p-4 bg-card border border-border text-center">
        <p className="text-xs text-text-muted mb-1">No cases yet</p>
        <p className="text-[10px] text-text-muted">Create one in the Birdbrain app.</p>
      </section>
    )
  }

  return (
    <section className="animate-fade-up">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-2">
        Active Case
      </h4>
      <select
        value={activeCase?.id ?? ''}
        onChange={(e) => {
          if (e.target.value) onSelect(e.target.value)
        }}
        className="w-full rounded-xl px-3 py-2.5 text-xs font-medium bg-card border border-border text-text-primary appearance-none cursor-pointer hover:bg-elevated transition-colors focus:outline-none focus:ring-1 focus:ring-accent"
      >
        {!activeCase && (
          <option value="" disabled>
            Select a case...
          </option>
        )}
        {cases.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.captureCount})
          </option>
        ))}
      </select>
    </section>
  )
}

// ---------- Disconnected View ----------

function DisconnectedView({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col w-[320px] font-body bg-canvas text-text-primary">
      <Header />
      <main className="p-4 flex-1 flex flex-col items-center justify-center py-12">
        <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
          <svg
            className="w-6 h-6 text-amber-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <h2 className="text-sm font-display font-bold text-text-primary mb-1">Birdbrain Not Found</h2>
        <p className="text-[11px] text-text-muted mb-6 text-center">
          Make sure the Birdbrain desktop app is running.
        </p>
        <button
          onClick={onRetry}
          className="h-9 px-6 rounded-md font-display font-bold text-xs bg-accent hover:bg-accent-hover text-white active:scale-[0.98] transition-all"
        >
          Retry Connection
        </button>
      </main>
    </div>
  )
}

// ---------- Main Popup ----------

function Popup(): React.JSX.Element {
  const [connected, setConnected] = useState(false)
  const [sessionActive, setSessionActive] = useState(false)
  const [activeCase, setActiveCase] = useState<{ id: string; name: string } | null>(null)
  const [cases, setCases] = useState<CaptureServerCase[]>([])
  const [captureCount, setCaptureCount] = useState(0)
  const [activeSelectorCount, setActiveSelectorCount] = useState(0)
  const [currentDomain, setCurrentDomain] = useState('')
  const [loading, setLoading] = useState(true)
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    checkStatus()
    // Get current tab domain
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        try {
          setCurrentDomain(new URL(tabs[0].url).hostname)
        } catch {
          setCurrentDomain('')
        }
      }
    })
  }, [])

  async function checkStatus(): Promise<void> {
    try {
      const status = await getStatus()
      setConnected(status.running)
      if (status.theme) applyPopupTheme(status.theme)
      setSessionActive(status.sessionActive)
      setActiveCase(status.activeCase)
      setCaptureCount(status.captureCount)

      if (status.running) {
        const caseList = await getCases()
        setCases(caseList)

        chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
          if (state) {
            setActiveSelectorCount(state.activeSelectorCount || 0)
          }
        })
      }
    } catch {
      setConnected(false)
    } finally {
      setLoading(false)
    }
  }

  async function handleActivateCase(id: string): Promise<void> {
    const result = await activateCase(id)
    setActiveCase(result.case)
  }

  async function handleStopCapture(): Promise<void> {
    await stopSession()
    setSessionActive(false)
    chrome.runtime.sendMessage({ type: 'SESSION_STOPPED' })
  }

  async function handleManualCapture(): Promise<void> {
    if (!activeCase || capturing) return
    setCapturing(true)
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      setCapturing(false)
      return
    }
    chrome.runtime.sendMessage({ type: 'MANUAL_CAPTURE', tabId: tab.id, caseId: activeCase.id })
    setTimeout(() => setCapturing(false), 3000)
  }

  // Loading
  if (loading) {
    return (
      <div className="flex flex-col w-[320px] font-body bg-canvas text-text-primary items-center justify-center py-16">
        <div className="w-6 h-6 rounded-md bg-accent flex items-center justify-center animate-pulse">
          <svg
            className="w-3 h-3 text-white"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="12" r="2" />
          </svg>
        </div>
      </div>
    )
  }

  // Disconnected
  if (!connected) {
    return <DisconnectedView onRetry={checkStatus} />
  }

  // Connected
  return (
    <div className="flex flex-col w-[320px] font-body bg-canvas text-text-primary">
      <Header />
      <main className="p-4 space-y-3.5">
        <CaseSelector cases={cases} activeCase={activeCase} onSelect={handleActivateCase} />

        {activeCase && (
          <StatusCard
            sessionActive={sessionActive}
            activeCase={activeCase}
            currentDomain={currentDomain}
          />
        )}

        <StatsGrid captureCount={captureCount} selectorCount={activeSelectorCount} />
      </main>
      <Footer
        sessionActive={sessionActive}
        activeCase={activeCase}
        onStopCapture={handleStopCapture}
        onManualCapture={handleManualCapture}
        capturing={capturing}
      />
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
)
