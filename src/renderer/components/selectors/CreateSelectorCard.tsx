import { useState } from 'react'
import { Plus, ChevronUp, ChevronDown, Search, FlaskConical, Crosshair } from 'lucide-react'
import { testPatternAgainstText, type MatchResult } from './selectorUtils'
import { Card, Button, Label } from '@renderer/components/ui'

interface TestResult {
  captureTitle: string
  captureUrl: string
  matches: MatchResult[]
}

interface CreateSelectorCardProps {
  isOpen: boolean
  onToggle: () => void
  onCreated: () => void
  caseId: string
}

export function CreateSelectorCard({
  isOpen,
  onToggle,
  onCreated,
  caseId
}: CreateSelectorCardProps) {
  const [pattern, setPattern] = useState('')
  const [isRegex, setIsRegex] = useState(false)
  const [label, setLabel] = useState('')
  const [regexError, setRegexError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResults, setTestResults] = useState<TestResult[] | null>(null)

  function validateRegex(value: string): boolean {
    if (!isRegex) return true
    try {
      new RegExp(value)
      setRegexError(null)
      return true
    } catch (err) {
      setRegexError(err instanceof Error ? err.message : 'Invalid regex')
      return false
    }
  }

  async function handleCreate() {
    if (!pattern.trim()) return
    if (!validateRegex(pattern)) return

    setCreating(true)
    try {
      await window.birdbrain.selectors.create({
        caseId,
        pattern: pattern.trim(),
        isRegex,
        label: label.trim() || undefined
      })
      setPattern('')
      setLabel('')
      setIsRegex(false)
      setRegexError(null)
      setTestResults(null)
      onCreated()
    } catch (err) {
      console.error('Failed to create selector:', err)
    } finally {
      setCreating(false)
    }
  }

  async function handleTest() {
    if (!pattern.trim()) return
    if (isRegex && !validateRegex(pattern)) return

    setTesting(true)
    try {
      const captures = await window.birdbrain.captures.list(caseId)
      const results: TestResult[] = []
      const toTest = captures.slice(0, 10)

      for (const capture of toTest) {
        try {
          const text = await window.birdbrain.captures.getContent(capture.id, 'txt')
          if (!text) continue
          const matches = testPatternAgainstText(pattern, isRegex, text)
          if (matches.length > 0) {
            results.push({
              captureTitle: capture.title || capture.url,
              captureUrl: capture.url,
              matches
            })
          }
        } catch {
          // skip captures that fail to load
        }
      }

      setTestResults(results)
    } catch (err) {
      console.error('Failed to test pattern:', err)
    } finally {
      setTesting(false)
    }
  }

  const totalMatches = testResults?.reduce((sum, r) => sum + r.matches.length, 0) ?? 0

  return (
    <Card>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-subtle">
          <Crosshair className="h-4 w-4 text-accent" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-sm font-semibold text-text-primary">
            Create New Selector
          </h3>
          <p className="text-xs text-text-muted">Define patterns to match across captures</p>
        </div>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-text-muted" />
        ) : (
          <ChevronDown className="h-4 w-4 text-text-muted" />
        )}
      </button>

      {isOpen && (
        <div className="expand-panel border-t border-border px-5 pb-5 pt-4 space-y-4">
          <div className="grid grid-cols-12 gap-4">
            {/* Pattern input */}
            <div className="col-span-6">
              <Label className="text-xs font-medium">Pattern</Label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                  <input
                    type="text"
                    value={pattern}
                    onChange={(e) => {
                      setPattern(e.target.value)
                      if (isRegex) validateRegex(e.target.value)
                    }}
                    placeholder={isRegex ? 'e.g. \\b\\d{3}-\\d{3}-\\d{4}\\b' : 'e.g. John Doe'}
                    className="w-full rounded-xl border border-border-strong bg-canvas py-1.5 pl-8 pr-3 font-mono text-sm text-text-primary placeholder:text-text-faint focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/25"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreate()
                    }}
                  />
                </div>
                <button
                  onClick={() => {
                    const next = !isRegex
                    setIsRegex(next)
                    if (next && pattern) validateRegex(pattern)
                    else setRegexError(null)
                  }}
                  className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-xs font-medium transition-colors ${
                    isRegex
                      ? 'bg-accent-subtle text-accent border border-accent/30'
                      : 'bg-surface text-text-muted border border-border hover:text-text-secondary'
                  }`}
                >
                  .*
                </button>
              </div>
              {regexError && <p className="mt-1 text-xs text-red-400">{regexError}</p>}
            </div>

            {/* Label input */}
            <div className="col-span-4">
              <Label className="text-xs font-medium">Label</Label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Phone numbers"
                className="w-full rounded-xl border border-border-strong bg-canvas px-3 py-1.5 text-sm text-text-primary placeholder:text-text-faint focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/25"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
                }}
              />
            </div>

            {/* Buttons */}
            <div className="col-span-2 flex items-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={!pattern.trim() || !!regexError || testing}
                className="gap-1"
              >
                <FlaskConical className="h-3.5 w-3.5" />
                {testing ? '...' : 'Test'}
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={!pattern.trim() || !!regexError || creating}
                className="gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                {creating ? '...' : 'Create'}
              </Button>
            </div>
          </div>

          {/* Live Test Preview */}
          {testResults !== null && (
            <div className="test-active rounded-xl border border-accent/20 bg-accent-subtle p-4">
              <div className="mb-3 flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-accent" />
                <span className="text-xs font-medium text-accent">Live Preview</span>
                <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-semibold text-accent">
                  {totalMatches} match{totalMatches !== 1 ? 'es' : ''}
                </span>
              </div>

              {testResults.length === 0 ? (
                <p className="text-xs text-text-muted">
                  No matches found in the first 10 captures.
                </p>
              ) : (
                <div className="space-y-2">
                  {testResults.slice(0, 5).map((result, idx) => (
                    <div key={idx} className="rounded-lg border border-border bg-elevated p-3">
                      <p className="mb-1 truncate text-xs text-text-muted">{result.captureTitle}</p>
                      {result.matches.slice(0, 3).map((m, mi) => (
                        <p key={mi} className="font-mono text-xs text-text-secondary">
                          ...{m.context.slice(0, m.index > 25 ? 25 : m.index)}
                          <span className="rounded bg-indigo-500/30 px-0.5 text-indigo-200">
                            {m.matchText}
                          </span>
                          {m.context.slice((m.index > 25 ? 25 : m.index) + m.matchText.length)}...
                        </p>
                      ))}
                      {result.matches.length > 3 && (
                        <p className="mt-1 text-[10px] text-text-muted">
                          +{result.matches.length - 3} more matches
                        </p>
                      )}
                    </div>
                  ))}
                  {testResults.length > 5 && (
                    <p className="text-xs text-accent">
                      View all {totalMatches} matches across {testResults.length} captures
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
