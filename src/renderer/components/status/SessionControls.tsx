import { useAppStore } from '@renderer/stores/appStore'
import { useCases } from '@renderer/hooks/useCases'

export function SessionControls() {
  const { sessionActive, setSessionActive, activeCaseId, setActiveCaseId, connectedToExtension } =
    useAppStore()
  const { cases } = useCases()

  if (!connectedToExtension) return null

  const activeCase = cases.find((c) => c.id === activeCaseId)

  const handleToggleSession = async () => {
    try {
      if (sessionActive) {
        const res = await fetch('http://127.0.0.1:19845/api/session/stop', { method: 'POST' })
        if (!res.ok) {
          console.error('Failed to stop session:', res.status)
          return
        }
        setSessionActive(false)
      } else {
        if (!activeCaseId) return
        const activateRes = await fetch(
          `http://127.0.0.1:19845/api/cases/${activeCaseId}/activate`,
          { method: 'POST' }
        )
        if (!activateRes.ok) {
          console.error('Failed to activate case:', activateRes.status)
          return
        }
        const startRes = await fetch('http://127.0.0.1:19845/api/session/start', { method: 'POST' })
        if (!startRes.ok) {
          console.error('Failed to start session:', startRes.status)
          return
        }
        setSessionActive(true)
      }
    } catch (error) {
      console.error('Failed to toggle session:', error)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={activeCaseId || ''}
        onChange={(e) => setActiveCaseId(e.target.value || null)}
        className="rounded border border-white/[0.08] bg-slate-800 px-2 py-1 text-xs text-slate-300 outline-none"
      >
        <option value="">Select case...</option>
        {cases.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <label className="flex cursor-pointer items-center gap-1.5">
        <span className="text-xs text-slate-400">Auto-Capture</span>
        <button
          type="button"
          role="switch"
          aria-checked={sessionActive}
          aria-label="Auto-Capture"
          onClick={handleToggleSession}
          disabled={!activeCaseId}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
            sessionActive ? 'bg-indigo-600' : 'bg-slate-600'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              sessionActive ? 'translate-x-[18px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      </label>
      {sessionActive && activeCase && (
        <span className="text-xs text-slate-500">{activeCase.name}</span>
      )}
    </div>
  )
}
