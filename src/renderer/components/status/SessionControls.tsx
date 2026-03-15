import { useAppStore } from '@renderer/stores/appStore'
import { useCases } from '@renderer/hooks/useCases'

export function SessionControls() {
  const { sessionActive, setSessionActive, activeCaseId, setActiveCaseId, connectedToExtension } =
    useAppStore()
  const { cases } = useCases()

  if (!connectedToExtension) return null

  const activeCase = cases.find((c) => c.id === activeCaseId)

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
      <label className="flex cursor-pointer items-center gap-1.5">
        <span className="text-xs text-neutral-400">Auto-Capture</span>
        <button
          type="button"
          role="switch"
          aria-checked={sessionActive}
          aria-label="Auto-Capture"
          onClick={handleToggleSession}
          disabled={!activeCaseId}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
            sessionActive ? 'bg-amber-600' : 'bg-neutral-600'
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
        <span className="text-xs text-neutral-500">{activeCase.name}</span>
      )}
    </div>
  )
}
