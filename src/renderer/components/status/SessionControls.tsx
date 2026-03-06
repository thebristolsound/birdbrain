import { useAppStore } from '@renderer/stores/appStore'
import { useCases } from '@renderer/hooks/useCases'

export function SessionControls() {
  const { sessionActive, setSessionActive, activeCaseId, setActiveCaseId, connectedToExtension } =
    useAppStore()
  const { cases } = useCases()

  if (!connectedToExtension) return null

  const handleToggleSession = async () => {
    if (sessionActive) {
      await fetch('http://127.0.0.1:19845/api/session/stop', { method: 'POST' })
      setSessionActive(false)
    } else {
      if (!activeCaseId) return
      await fetch(`http://127.0.0.1:19845/api/cases/${activeCaseId}/activate`, { method: 'POST' })
      await fetch('http://127.0.0.1:19845/api/session/start', { method: 'POST' })
      setSessionActive(true)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={activeCaseId || ''}
        onChange={(e) => setActiveCaseId(e.target.value || null)}
        className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-300 outline-none"
      >
        <option value="">Select case...</option>
        {cases.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        onClick={handleToggleSession}
        disabled={!activeCaseId}
        className={`rounded px-3 py-1 text-xs font-medium ${
          sessionActive
            ? 'bg-red-600 text-white hover:bg-red-500'
            : 'bg-amber-600 text-white hover:bg-amber-500'
        } disabled:opacity-50`}
      >
        {sessionActive ? 'Stop' : 'Start'}
      </button>
    </div>
  )
}
