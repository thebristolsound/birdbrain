import { useState } from 'react'
import { useCases } from '@renderer/hooks/useCases'
import { useAppStore } from '@renderer/stores/appStore'
import { CreateCaseDialog } from '@renderer/components/cases/CreateCaseDialog'

export function Dashboard() {
  const { cases } = useCases()
  const { selectCase, connectedToExtension } = useAppStore()
  const [showCreate, setShowCreate] = useState(false)

  const recentCases = cases.slice(0, 5)

  return (
    <div data-testid="dashboard" className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-amber-500">Birdbrain</h1>
        <p className="mt-1 text-neutral-400">Web investigation & capture tool</p>
      </div>

      {/* Extension Status */}
      <div
        className={`rounded-lg border p-4 ${
          connectedToExtension
            ? 'border-green-800 bg-green-950/30'
            : 'border-neutral-700 bg-neutral-900'
        }`}
      >
        <h3 className="font-medium text-neutral-200">
          {connectedToExtension ? 'Chrome Extension Connected' : 'Chrome Extension Not Connected'}
        </h3>
        {!connectedToExtension && (
          <div className="mt-2 space-y-1 text-sm text-neutral-400">
            <p>To get started:</p>
            <ol className="ml-4 list-decimal space-y-1">
              <li>Open Chrome and navigate to <span className="font-mono text-amber-500">chrome://extensions</span></li>
              <li>Enable "Developer mode" (top right)</li>
              <li>Click "Load unpacked" and select the <span className="font-mono text-amber-500">extension/dist</span> folder</li>
              <li>The extension icon will appear in your toolbar</li>
            </ol>
          </div>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-2xl font-bold text-neutral-100">{cases.length}</div>
          <div className="text-sm text-neutral-400">Cases</div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-2xl font-bold text-neutral-100">-</div>
          <div className="text-sm text-neutral-400">Total Captures</div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-2xl font-bold text-neutral-100">-</div>
          <div className="text-sm text-neutral-400">Storage Used</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <button
          data-testid="new-case-btn"
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
        >
          + New Case
        </button>
      </div>

      {/* Recent Cases */}
      {recentCases.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-neutral-200">Recent Cases</h2>
          <div className="space-y-2">
            {recentCases.map((c) => (
              <button
                key={c.id}
                data-testid="case-card"
                onClick={() => selectCase(c.id)}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-left transition hover:border-amber-800"
              >
                <div className="font-medium text-neutral-200">{c.name}</div>
                {c.description && (
                  <div className="mt-1 text-sm text-neutral-500">{c.description}</div>
                )}
                <div className="mt-1 font-mono text-xs text-neutral-600">
                  Updated {new Date(c.updatedAt).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {showCreate && <CreateCaseDialog onClose={() => setShowCreate(false)} />}
    </div>
  )
}
