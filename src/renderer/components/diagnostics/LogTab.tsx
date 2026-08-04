import { useEffect, useState } from 'react'
import { AlertCircle, AlertTriangle, FolderOpen, Info } from 'lucide-react'
import { Button } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import { labelForCode } from '@renderer/lib/notify'
import { recentLogEntries, revealLogFile } from '@renderer/lib/api/diagnostics'
import type { LogEntry, LogLevel } from '@shared/types'

const MAX_ENTRIES = 200
const LEVELS: LogLevel[] = ['error', 'warn', 'info']

const LEVEL_ICON = {
  error: AlertCircle,
  warn: AlertTriangle,
  info: Info
} as const

const LEVEL_COLOR = {
  error: 'text-red-500',
  warn: 'text-amber-500',
  info: 'text-text-muted'
} as const

export function LogTab() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [active, setActive] = useState<LogLevel[]>(LEVELS)

  useEffect(() => {
    // Subscribe BEFORE loading history, so an entry arriving mid-load is not
    // dropped in the gap between the two.
    const unsubscribe = window.birdbrain.onLogEntry((entry) => {
      setEntries((prev) => [entry, ...prev].slice(0, MAX_ENTRIES))
    })

    // Live events alone would start this tab empty, which fails its actual
    // use: a tester opens Settings → Diagnostics BECAUSE something failed, and
    // the failure they came to look at has already happened. Merge by id —
    // history and the live subscription overlap by design.
    let cancelled = false
    void recentLogEntries(MAX_ENTRIES)
      .then((history) => {
        if (cancelled) return
        setEntries((prev) => {
          const seen = new Set(prev.map((e) => e.id))
          return [...prev, ...history.filter((e) => !seen.has(e.id))].slice(0, MAX_ENTRIES)
        })
      })
      .catch(() => {
        // No history is a degraded tab, not a broken one.
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  function toggle(level: LogLevel): void {
    setActive((prev) => (prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]))
  }

  const visible = entries.filter((e) => active.includes(e.level))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          {LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => toggle(level)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs capitalize transition-colors',
                active.includes(level)
                  ? 'border-accent bg-accent/10 text-text-primary'
                  : 'border-border text-text-muted'
              )}
            >
              {level}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => revealLogFile()}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Reveal log file
        </Button>
      </div>

      <div className="max-h-[300px] space-y-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">No log entries</p>
        ) : (
          visible.map((entry) => {
            const Icon = LEVEL_ICON[entry.level]
            return (
              <div
                key={entry.id}
                className="flex items-start gap-2 rounded border border-border px-2 py-1.5"
              >
                <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', LEVEL_COLOR[entry.level])} />
                <div className="min-w-0 flex-1">
                  {/* Codes are not prose. labelForCode maps a code to a readable
                      sentence for display only — the code is what is on disk,
                      and LogEntry has no message field to render. */}
                  <p className="truncate text-sm text-text-primary">{labelForCode(entry.code)}</p>
                  <p className="text-xs text-text-muted">
                    <span className="font-mono">{entry.source}</span>
                    {' · '}
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
