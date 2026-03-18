import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { getStatus, getCases, activateCase, startSession, stopSession } from '@extension/utils/api'

interface CaseInfo {
  id: string
  name: string
  captureCount: number
}

function Popup(): React.JSX.Element {
  const [connected, setConnected] = useState(false)
  const [sessionActive, setSessionActive] = useState(false)
  const [activeCase, setActiveCase] = useState<{ id: string; name: string } | null>(null)
  const [cases, setCases] = useState<CaseInfo[]>([])
  const [captureCount, setCaptureCount] = useState(0)
  const [activeSelectorCount, setActiveSelectorCount] = useState(0)
  const [activeCaseCount, setActiveCaseCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkStatus()
  }, [])

  async function checkStatus(): Promise<void> {
    try {
      const status = await getStatus()
      setConnected(status.running)
      setSessionActive(status.sessionActive)
      setActiveCase(status.activeCase)
      setCaptureCount(status.captureCount)

      if (status.running) {
        const caseList = await getCases()
        setCases(caseList)

        // Get selector state from background
        chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
          if (state) {
            setActiveSelectorCount(state.activeSelectorCount || 0)
            setActiveCaseCount(state.activeCaseCount || 0)
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

  async function handleStartCapture(): Promise<void> {
    await startSession()
    setSessionActive(true)
    setCaptureCount(0)
  }

  async function handleStopCapture(): Promise<void> {
    await stopSession()
    setSessionActive(false)
    chrome.runtime.sendMessage({ type: 'SESSION_STOPPED' })
  }

  async function handleManualCapture(): Promise<void> {
    if (!activeCase) return
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    chrome.runtime.sendMessage({ type: 'MANUAL_CAPTURE', tabId: tab.id, caseId: activeCase.id })
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>Loading...</div>
  }

  // Disconnected state
  if (!connected) {
    return (
      <div style={{ textAlign: 'center' }}>
        <span style={{ display: 'inline-block', fontSize: '24px', marginBottom: '8px', color: '#f59e0b' }}>!</span>
        <h2 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
          Birdbrain not found
        </h2>
        <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '16px' }}>
          Make sure the Birdbrain desktop app is running.
        </p>
        <button onClick={checkStatus} style={buttonStyle}>
          Retry Connection
        </button>
      </div>
    )
  }

  // Active recording state
  if (sessionActive && activeCase) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ color: '#ef4444', fontSize: '12px' }}>●</span>
          <span style={{ fontWeight: 600, fontSize: '14px' }}>Auto-Capture Active</span>
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
          Case: {activeCase.name}
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
          Captures: {captureCount}
        </div>
        {activeSelectorCount > 0 && (
          <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '16px' }}>
            Selectors: {activeSelectorCount} active across {activeCaseCount} case{activeCaseCount !== 1 ? 's' : ''}
          </div>
        )}
        {activeSelectorCount === 0 && (
          <div style={{ marginBottom: '16px' }} />
        )}
        <button onClick={handleManualCapture} style={{ ...buttonStyle, marginBottom: '8px' }}>
          Capture This Page
        </button>
        <button onClick={handleStopCapture} style={{ ...buttonStyle, background: '#ef4444' }}>
          Stop Auto-Capture
        </button>
      </div>
    )
  }

  // Connected, inactive state
  return (
    <div>
      <h2 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#10b981' }}>
        Birdbrain Connected
      </h2>

      {cases.length > 0 ? (
        <>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>
            Select case:
          </div>
          <div style={{ marginBottom: '12px' }}>
            {cases.map((c) => (
              <div
                key={c.id}
                onClick={() => handleActivateCase(c.id)}
                style={{
                  padding: '8px',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  fontSize: '13px',
                  background: activeCase?.id === c.id ? '#1e293b' : 'transparent',
                  border: activeCase?.id === c.id ? '1px solid #4f46e5' : '1px solid transparent',
                  marginBottom: '4px'
                }}
              >
                {c.name}
                <span style={{ fontSize: '11px', color: '#64748b', marginLeft: '8px' }}>
                  ({c.captureCount})
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>
          No cases yet. Create one in the Birdbrain app.
        </p>
      )}

      <button
        onClick={handleManualCapture}
        disabled={!activeCase}
        style={{
          ...buttonStyle,
          marginBottom: '8px',
          opacity: activeCase ? 1 : 0.5,
          cursor: activeCase ? 'pointer' : 'not-allowed'
        }}
      >
        Capture This Page
      </button>
      <button
        onClick={handleStartCapture}
        disabled={!activeCase}
        style={{
          ...buttonStyle,
          background: '#10b981',
          opacity: activeCase ? 1 : 0.5,
          cursor: activeCase ? 'pointer' : 'not-allowed'
        }}
      >
        Start Auto-Capture
      </button>
    </div>
  )
}

const buttonStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 16px',
  border: 'none',
  borderRadius: '10px',
  background: '#4f46e5',
  color: '#ffffff',
  fontWeight: 600,
  fontSize: '13px',
  cursor: 'pointer'
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
)
