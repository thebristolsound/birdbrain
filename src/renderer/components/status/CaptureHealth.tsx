import { useState } from 'react'
import { Activity, CheckCircle2, XCircle, AlertTriangle, Loader2, Zap } from 'lucide-react'
import { useAppStore } from '@renderer/stores/appStore'
import type { CaptureEvent } from '@shared/types'

function EventIcon({ type }: { type: CaptureEvent['type'] }) {
  switch (type) {
    case 'stored': return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
    case 'failed': return <XCircle className="h-3.5 w-3.5 text-red-400" />
    case 'skipped': return <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
    case 'received': return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
    case 'extraction_done': return <Zap className="h-3.5 w-3.5 text-indigo-400" />
  }
}

function EventRow({ event }: { event: CaptureEvent }) {
  const time = new Date(event.timestamp).toLocaleTimeString()
  const urlShort = event.url.length > 40 ? event.url.slice(0, 40) + '...' : event.url

  return (
    <div className="flex items-start gap-2 px-3 py-1.5 text-[11px]">
      <EventIcon type={event.type} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-slate-300">{urlShort}</div>
        <div className="flex gap-2 text-slate-500">
          <span>{event.source}</span>
          <span>{time}</span>
          {event.durationMs !== undefined && <span>{event.durationMs}ms</span>}
          {event.error && <span className="text-red-400">{event.error}</span>}
          {event.skipReason && <span className="text-amber-400">{event.skipReason}</span>}
        </div>
      </div>
    </div>
  )
}

export function CaptureHealth() {
  const [open, setOpen] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    durationMs: number
    error?: string
  } | null>(null)
  const [testing, setTesting] = useState(false)
  const captureEvents = useAppStore((s) => s.captureEvents)
  const captureStats = useAppStore((s) => s.captureStats)
  const clearCaptureEvents = useAppStore((s) => s.clearCaptureEvents)
  const sessionActive = useAppStore((s) => s.sessionActive)
  const connectedToExtension = useAppStore((s) => s.connectedToExtension)

  async function runPipelineTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.birdbrain.testPipeline()
      setTestResult(result)
    } catch (err) {
      setTestResult({ success: false, durationMs: 0, error: String(err) })
    } finally {
      setTesting(false)
    }
  }

  async function runHttpTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.birdbrain.testHttp()
      setTestResult(result)
    } catch (err) {
      setTestResult({ success: false, durationMs: 0, error: String(err) })
    } finally {
      setTesting(false)
    }
  }

  const hasFailures = captureStats.failCount > 0

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors ${
          hasFailures
            ? 'border-red-500/20 bg-red-500/10 text-red-400'
            : captureStats.successCount > 0
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
              : 'border-slate-700 bg-slate-800 text-slate-500'
        }`}
        title="Capture pipeline health"
      >
        <Activity className="h-3.5 w-3.5" />
        {captureStats.successCount > 0 && <span>{captureStats.successCount}</span>}
        {hasFailures && <span className="text-red-400">/{captureStats.failCount}!</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-96 rounded-lg border border-white/[0.06] bg-slate-900 shadow-xl">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
            <span className="text-xs font-medium text-slate-300">Capture Pipeline</span>
            <button
              onClick={clearCaptureEvents}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >
              Clear
            </button>
          </div>

          <div className="flex gap-4 border-b border-white/[0.06] px-3 py-2 text-[11px]">
            <div className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${connectedToExtension ? 'bg-emerald-500' : 'bg-slate-500'}`}
              />
              <span className="text-slate-400">
                {connectedToExtension ? 'Extension' : 'No extension'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${sessionActive ? 'animate-pulse bg-red-500' : 'bg-slate-500'}`}
              />
              <span className="text-slate-400">{sessionActive ? 'Recording' : 'Idle'}</span>
            </div>
            <div className="text-slate-500">
              {captureStats.successCount}ok / {captureStats.failCount}fail /{' '}
              {captureStats.skipCount}skip
            </div>
          </div>

          {captureStats.lastError && (
            <div className="border-b border-white/[0.06] px-3 py-2">
              <div className="text-[10px] font-medium text-red-400">Last error</div>
              <div className="text-[11px] text-slate-400">{captureStats.lastError.message}</div>
              <div className="text-[10px] text-slate-600">
                {new Date(captureStats.lastError.timestamp).toLocaleTimeString()}
              </div>
            </div>
          )}

          <div className="max-h-60 overflow-y-auto">
            {captureEvents.length === 0 ? (
              <div className="px-3 py-6 text-center text-[11px] text-slate-600">
                No capture activity yet
              </div>
            ) : (
              captureEvents.map((event, i) => <EventRow key={i} event={event} />)
            )}
          </div>

          <div className="flex gap-2 border-t border-white/[0.06] px-3 py-2">
            <button
              onClick={runPipelineTest}
              disabled={testing}
              className="flex-1 rounded bg-slate-800 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-slate-700 disabled:opacity-50"
            >
              {testing ? 'Testing...' : 'Test Pipeline'}
            </button>
            <button
              onClick={runHttpTest}
              disabled={testing}
              className="flex-1 rounded bg-slate-800 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-slate-700 disabled:opacity-50"
            >
              {testing ? 'Testing...' : 'Test HTTP'}
            </button>
          </div>

          {testResult && (
            <div
              className={`px-3 py-2 text-[11px] ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {testResult.success
                ? `Pipeline OK — verified in ${testResult.durationMs}ms`
                : `Pipeline FAILED: ${testResult.error}`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
