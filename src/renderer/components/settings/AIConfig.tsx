import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { BirdbrainSettings } from '@shared/types'
import { Button, Card, CardContent, Input, Label, Textarea } from '@renderer/components/ui'
import { Check, Eye, EyeOff, Loader2, X } from 'lucide-react'
import { useOpenRouterModels } from '@renderer/hooks/useOpenRouterModels'
import { presets } from '@renderer/lib/motion'

export interface AIConfigProps {
  settings: BirdbrainSettings
  onUpdate: (partial: Partial<BirdbrainSettings>) => Promise<void>
}

export function AIConfig({ settings, onUpdate }: AIConfigProps) {
  const [apiKey, setApiKey] = useState(settings.openRouterApiKey ?? '')
  const [showKey, setShowKey] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [selectedModel, setSelectedModel] = useState(settings.defaultModel)
  const [systemPrompt, setSystemPrompt] = useState(settings.analysisSystemPrompt ?? '')

  // Models refresh automatically whenever settings.openRouterApiKey changes.
  const { models, loading: loadingModels } = useOpenRouterModels(settings.openRouterApiKey)

  async function handleTestKey() {
    if (!apiKey.trim()) return
    setTestStatus('testing')
    try {
      const ok = await window.birdbrain.settings.testOpenRouter(apiKey.trim())
      if (ok) {
        setTestStatus('success')
        await onUpdate({ openRouterApiKey: apiKey.trim() })
      } else {
        setTestStatus('error')
      }
    } catch {
      setTestStatus('error')
    }
    setTimeout(() => setTestStatus('idle'), 3000)
  }

  async function handleSaveKey() {
    await onUpdate({ openRouterApiKey: apiKey.trim() || null })
  }

  async function handleModelChange(modelId: string) {
    setSelectedModel(modelId)
    await onUpdate({ defaultModel: modelId })
  }

  async function handlePromptSave() {
    await onUpdate({ analysisSystemPrompt: systemPrompt })
  }

  return (
    <div className="space-y-6">
      {/* API Key */}
      <Card>
        <CardContent className="pt-5">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">OpenRouter API Key</h3>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onBlur={handleSaveKey}
                placeholder="sk-or-v1-..."
                className="border-border bg-surface pr-9 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <Button
              size="sm"
              variant={
                testStatus === 'success'
                  ? 'default'
                  : testStatus === 'error'
                    ? 'destructive'
                    : 'default'
              }
              onClick={handleTestKey}
              disabled={!apiKey.trim() || testStatus === 'testing'}
            >
              <AnimatePresence mode="wait">
                {testStatus === 'testing' ? (
                  <motion.span
                    key="testing"
                    className="inline-flex items-center"
                    initial={presets.fadeIn.initial}
                    animate={presets.fadeIn.animate}
                    exit={presets.fadeIn.exit}
                    transition={presets.fadeIn.transition}
                  >
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  </motion.span>
                ) : testStatus === 'success' ? (
                  <motion.span
                    key="success"
                    className="inline-flex items-center"
                    initial={presets.fadeIn.initial}
                    animate={presets.fadeIn.animate}
                    exit={presets.fadeIn.exit}
                    transition={presets.fadeIn.transition}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" /> Valid
                  </motion.span>
                ) : testStatus === 'error' ? (
                  <motion.span
                    key="error"
                    className="inline-flex items-center"
                    initial={presets.fadeIn.initial}
                    animate={presets.fadeIn.animate}
                    exit={presets.fadeIn.exit}
                    transition={presets.fadeIn.transition}
                  >
                    <X className="mr-1 h-3.5 w-3.5" /> Failed
                  </motion.span>
                ) : (
                  <motion.span
                    key="default"
                    initial={presets.fadeIn.initial}
                    animate={presets.fadeIn.animate}
                    exit={presets.fadeIn.exit}
                    transition={presets.fadeIn.transition}
                  >
                    Test
                  </motion.span>
                )}
              </AnimatePresence>
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            Get your API key from{' '}
            <button
              onClick={() => window.birdbrain.captures.openExternal('https://openrouter.ai/keys')}
              className="text-accent hover:underline"
            >
              openrouter.ai/keys
            </button>
            . Stored encrypted on this device.
          </p>
        </CardContent>
      </Card>

      {/* Default Model */}
      <Card>
        <CardContent className="pt-5">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Default Model</h3>
          <AnimatePresence mode="wait">
            {loadingModels ? (
              <motion.div
                key="loading"
                className="flex items-center gap-2 text-xs text-text-muted"
                initial={presets.fadeIn.initial}
                animate={presets.fadeIn.animate}
                exit={presets.fadeIn.exit}
                transition={presets.fadeIn.transition}
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading models...
              </motion.div>
            ) : models.length > 0 ? (
              <motion.div
                key="select"
                initial={presets.fadeIn.initial}
                animate={presets.fadeIn.animate}
                exit={presets.fadeIn.exit}
                transition={presets.fadeIn.transition}
              >
                <select
                  value={selectedModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.contextLength.toLocaleString()} ctx)
                    </option>
                  ))}
                </select>
              </motion.div>
            ) : (
              <motion.div
                key="manual"
                className="space-y-2"
                initial={presets.fadeIn.initial}
                animate={presets.fadeIn.animate}
                exit={presets.fadeIn.exit}
                transition={presets.fadeIn.transition}
              >
                <Input
                  type="text"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  onBlur={() => handleModelChange(selectedModel)}
                  placeholder="anthropic/claude-sonnet-4"
                  className="border-border bg-surface font-mono text-xs"
                />
                <p className="text-[11px] text-text-muted">
                  {settings.openRouterApiKey
                    ? 'Could not load model list. Enter a model ID manually.'
                    : 'Add an API key above to load available models.'}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* System Prompt */}
      <Card>
        <CardContent className="pt-5">
          <Label className="mb-2 block text-sm font-semibold text-text-primary">
            Analysis System Prompt
          </Label>
          <Textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            onBlur={handlePromptSave}
            rows={6}
            className="border-border bg-surface text-xs text-text-secondary"
            placeholder="You are an expert investigative analyst..."
          />
          <p className="mt-2 text-[11px] text-text-muted">
            System message sent with every capture analysis. Customize for your investigation focus
            (forensics, OSINT, cybersecurity, etc.).
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
