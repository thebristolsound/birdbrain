import { useState } from 'react'
import type { BirdbrainSettings, OpenRouterModel } from '@shared/types'

interface AIConfigProps {
  settings: BirdbrainSettings
  onUpdate: (partial: Partial<BirdbrainSettings>) => Promise<void>
}

export function AIConfig({ settings, onUpdate }: AIConfigProps) {
  const [apiKey, setApiKey] = useState(settings.openRouterApiKey || '')
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<boolean | null>(null)
  const [models, setModels] = useState<OpenRouterModel[]>([])
  const [loadingModels, setLoadingModels] = useState(false)

  const handleTestKey = async () => {
    if (!apiKey.trim()) return
    setTesting(true)
    setTestResult(null)
    try {
      const valid = await window.birdbrain.settings.testOpenRouter(apiKey)
      setTestResult(valid)
      if (valid) {
        await onUpdate({ openRouterApiKey: apiKey })
        setLoadingModels(true)
        const modelList = await window.birdbrain.settings.listModels(apiKey)
        setModels(modelList)
        setLoadingModels(false)
      }
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-4 text-lg font-semibold text-neutral-200">AI Configuration</h2>

      {/* API Key */}
      <div className="mb-4">
        <label className="mb-1 block text-sm text-neutral-400">OpenRouter API Key</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value)
                setTestResult(null)
              }}
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 pr-10 font-mono text-sm text-neutral-100 outline-none focus:border-amber-600"
              placeholder="sk-or-..."
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-500 hover:text-neutral-300"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <button
            onClick={handleTestKey}
            disabled={!apiKey.trim() || testing}
            className="rounded bg-amber-600 px-3 py-2 text-sm text-white hover:bg-amber-500 disabled:opacity-50"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
        {testResult !== null && (
          <p className={`mt-1 text-sm ${testResult ? 'text-green-400' : 'text-red-400'}`}>
            {testResult ? 'API key is valid' : 'Invalid API key'}
          </p>
        )}
      </div>

      {/* Model Selector */}
      <div className="mb-4">
        <label className="mb-1 block text-sm text-neutral-400">Default Model</label>
        <select
          value={settings.defaultModel}
          onChange={(e) => onUpdate({ defaultModel: e.target.value })}
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none"
        >
          <option value={settings.defaultModel}>{settings.defaultModel}</option>
          {models
            .filter((m) => m.id !== settings.defaultModel)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.contextLength.toLocaleString()} ctx)
              </option>
            ))}
        </select>
        {loadingModels && <p className="mt-1 text-xs text-neutral-500">Loading models...</p>}
      </div>

      {/* Auto Extract */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={settings.autoExtractEntities}
          onChange={(e) => onUpdate({ autoExtractEntities: e.target.checked })}
          className="rounded"
        />
        <span className="text-sm text-neutral-300">Auto-extract entities on capture</span>
      </label>
    </section>
  )
}
