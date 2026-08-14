import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, Check, Copy, MessageSquareWarning, RefreshCw } from 'lucide-react'
import type { DiagnosticsSnapshot, KeyProtectionState } from '@shared/types'
import {
  Card,
  CardContent,
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent
} from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import { LogTab } from '@renderer/components/diagnostics/LogTab'
import { openPath } from '@renderer/lib/api/system'
import { diagnosticsQueryOptions } from '@renderer/lib/api/diagnostics'
import { notify } from '@renderer/lib/notify'

// Settings → Diagnostics. Live snapshot of app environment, main-process
// responsiveness (event-loop stalls = the "pinwheel"), storage, and the
// slow-operation log. Polls while open so stalls show up as they happen.

const POLL_MS = 2000

function formatBytes(value: number): string {
  if (value <= 0) return '0 B'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB']
  let v = value
  let i = -1
  do {
    v /= 1024
    i += 1
  } while (v >= 1024 && i < units.length - 1)
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

function formatCount(n: number): string {
  return n < 0 ? '—' : n.toLocaleString()
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString()
}

// 'plaintext' is the mis-attestation risk this indicator exists to surface
// (#414) — it means the OS credential store was unavailable when the key was
// written, so it sits on disk in the clear. 'not-set' only applies to the
// revocable OpenRouter key, never the signing key.
function keyProtectionLabel(state: KeyProtectionState): {
  value: string
  tone: 'default' | 'danger'
} {
  switch (state) {
    case 'protected':
      return { value: 'Protected', tone: 'default' }
    case 'plaintext':
      return { value: 'Unprotected', tone: 'danger' }
    case 'not-set':
      return { value: 'Not set', tone: 'default' }
  }
}

// Tone thresholds: <100ms lag is normal scheduling noise, ≥100ms is visible
// jank, ≥500ms is a user-perceptible freeze.
function lagTone(ms: number): 'default' | 'warning' | 'danger' {
  if (ms >= 500) return 'danger'
  if (ms >= 100) return 'warning'
  return 'default'
}

function StatBlock({
  label,
  value,
  tone = 'default'
}: {
  label: string
  value: string
  tone?: 'default' | 'warning' | 'danger'
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface px-4 py-3">
      <div className="truncate text-[11px] font-medium uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 truncate font-mono text-lg font-semibold tabular-nums text-text-primary',
          tone === 'warning' && 'text-amber-500',
          tone === 'danger' && 'text-red-500'
        )}
      >
        {value}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-text-primary">{title}</h3>
      {children}
    </div>
  )
}

export function DiagnosticsPanel() {
  const [copied, setCopied] = useState(false)
  const { data, refetch, isFetching } = useQuery({
    ...diagnosticsQueryOptions,
    refetchInterval: POLL_MS
  })

  async function handleCopy() {
    if (!data) return
    // The clipboard is an export path, and it is one keystroke from a chat
    // window or an issue tracker — so it gets the same redaction the bug-report
    // bundle gets, not the raw snapshot. storageRoot and dbPath are absolute
    // paths carrying the operator's username, and slowOps[].detail is a
    // captured page URL. The panel may show them on screen (that is the
    // operator looking at their own machine); copying them out is different.
    await navigator.clipboard.writeText(
      JSON.stringify(
        {
          ...data,
          storage: {
            ...data.storage,
            storageRoot: data.storage.storageRoot ? '‹path›' : '',
            dbPath: data.storage.dbPath ? data.storage.dbPath.split(/[\\/]/).pop() : ''
          },
          slowOps: data.slowOps.map((op) => ({ ...op, detail: '' }))
        },
        null,
        2
      )
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!data) {
    return <p className="text-sm text-text-muted">Collecting diagnostics…</p>
  }

  const snap: DiagnosticsSnapshot = data
  const schemaMismatch = snap.data.schemaVersion !== snap.data.latestSchemaVersion

  // notify, not local state: the panel owns no error region, and it is the
  // surface an operator is already on when diagnosing an environment fault.
  // The reason may name the storage path and stays in the toast — the ban is on
  // durable and exportable copies, not on screen. The button below already
  // prints storageRoot verbatim, RendererLogPayload has no message field, and
  // redactSnapshot rewrites the path in anything that leaves the app.
  // The resolved-reason branch is defensive only: main turns a non-empty
  // shell.openPath reason into an IpcFailure that preload rethrows, so this
  // bridge rejects for both of openPath's signals. Kept because it mirrors
  // ExportComplete and because lib/api/system still types this Promise<string>.
  async function handleOpenStorageRoot() {
    try {
      const reason = await openPath(snap.storage.storageRoot)
      if (reason) notify.error(`Couldn't open the storage folder — ${reason}`)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      notify.error(`Couldn't open the storage folder — ${reason}`, { cause: err })
    }
  }

  return (
    <Card>
      <CardContent>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Activity className="h-4 w-4" />
            Diagnostics
          </h2>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-1.5"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
              Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1.5">
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? 'Copied' : 'Copy report'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() =>
                window.dispatchEvent(new CustomEvent('birdbrain:report', { detail: {} }))
              }
            >
              <MessageSquareWarning className="h-3.5 w-3.5" />
              Report a problem
            </Button>
          </div>
        </div>

        <Tabs defaultValue="snapshot">
          <TabsList className="mb-4">
            <TabsTrigger value="snapshot">Snapshot</TabsTrigger>
            <TabsTrigger value="log">Log</TabsTrigger>
          </TabsList>

          <TabsContent value="snapshot" className="space-y-6">
            <Section title="Environment">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatBlock label="Version" value={snap.app.version} />
                <StatBlock label="Platform" value={`${snap.app.platform} ${snap.app.arch}`} />
                <StatBlock label="Install" value={snap.app.installFormat} />
                <StatBlock label="Uptime" value={formatUptime(snap.uptimeSeconds)} />
              </div>
              <p className="mt-2 text-xs text-text-muted">
                Electron {snap.app.electron} · Chromium {snap.app.chrome} · Node {snap.app.node}
              </p>
            </Section>

            <Section title="Key protection at rest">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatBlock
                  label="Signing key"
                  value={keyProtectionLabel(snap.keyProtection.signingKey).value}
                  tone={keyProtectionLabel(snap.keyProtection.signingKey).tone}
                />
                <StatBlock
                  label="OpenRouter key"
                  value={keyProtectionLabel(snap.keyProtection.openRouterKey).value}
                  tone={keyProtectionLabel(snap.keyProtection.openRouterKey).tone}
                />
              </div>
              {snap.keyProtection.signingKey === 'plaintext' && (
                <p className="mt-2 text-xs text-text-muted">
                  No OS credential store (Keychain, DPAPI, or a Linux Secret Service) was available
                  when this installation's signing key was generated, so it was written to disk
                  unprotected.
                </p>
              )}
            </Section>

            <Section title="Responsiveness">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatBlock
                  label="Event-loop lag"
                  value={formatMs(snap.eventLoop.currentLagMs)}
                  tone={lagTone(snap.eventLoop.currentLagMs)}
                />
                <StatBlock
                  label="Max lag (60s)"
                  value={formatMs(snap.eventLoop.maxLagLastMinuteMs)}
                  tone={lagTone(snap.eventLoop.maxLagLastMinuteMs)}
                />
                <StatBlock label="Freezes logged" value={String(snap.eventLoop.stalls.length)} />
                <StatBlock label="Slow ops logged" value={String(snap.slowOps.length)} />
              </div>
              {snap.eventLoop.stalls.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {snap.eventLoop.stalls.slice(0, 8).map((s, i) => (
                    <li key={`${s.at}-${i}`} className="flex justify-between text-xs">
                      <span className="text-text-muted">{formatTime(s.at)}</span>
                      <span className="font-mono text-red-500">app frozen {formatMs(s.ms)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Recent slow operations">
              {snap.slowOps.length === 0 ? (
                <p className="text-xs text-text-muted">
                  None recorded. Data extraction runs are logged here with their duration.
                </p>
              ) : (
                <ul className="space-y-1">
                  {snap.slowOps.slice(0, 10).map((op, i) => (
                    <li key={`${op.at}-${i}`} className="flex items-baseline gap-2 text-xs">
                      <span className="shrink-0 text-text-muted">{formatTime(op.at)}</span>
                      <span className="shrink-0 rounded bg-elevated px-1.5 py-0.5 text-text-secondary">
                        {op.kind}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-text-muted">{op.detail}</span>
                      <span
                        className={cn(
                          'shrink-0 font-mono tabular-nums',
                          op.ms >= 1000
                            ? 'text-red-500'
                            : op.ms >= 250
                              ? 'text-amber-500'
                              : 'text-text-secondary'
                        )}
                      >
                        {formatMs(op.ms)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Storage & data">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatBlock label="Database" value={formatBytes(snap.storage.dbSizeBytes)} />
                <StatBlock label="WAL" value={formatBytes(snap.storage.walSizeBytes)} />
                <StatBlock
                  label="Schema"
                  value={`v${snap.data.schemaVersion}${schemaMismatch ? ` / v${snap.data.latestSchemaVersion}` : ''}`}
                  tone={schemaMismatch ? 'warning' : 'default'}
                />
                <StatBlock label="Captures" value={formatCount(snap.data.captures)} />
              </div>
              <p className="mt-2 text-xs text-text-muted">
                {formatCount(snap.data.cases)} cases · {formatCount(snap.data.notes)} notes ·{' '}
                {formatCount(snap.data.selectors)} selectors ·{' '}
                {formatCount(snap.data.extractedData)} extracted indicators
              </p>
              <button
                type="button"
                onClick={() => void handleOpenStorageRoot()}
                className="mt-1 block max-w-full truncate font-mono text-xs text-accent hover:text-accent-hover"
                title="Open storage folder"
              >
                {snap.storage.storageRoot}
              </button>
            </Section>

            <Section title="Processes">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-text-muted">
                      <th className="py-1 pr-4 font-medium">Type</th>
                      <th className="py-1 pr-4 font-medium">PID</th>
                      <th className="py-1 pr-4 font-medium">CPU</th>
                      <th className="py-1 font-medium">Memory</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap.processes.map((p) => (
                      <tr key={p.pid} className="border-t border-border text-text-secondary">
                        <td className="py-1 pr-4">{p.type}</td>
                        <td className="py-1 pr-4 font-mono tabular-nums">{p.pid}</td>
                        <td className="py-1 pr-4 font-mono tabular-nums">{p.cpuPercent}%</td>
                        <td className="py-1 font-mono tabular-nums">{p.memoryMB} MB</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </TabsContent>

          <TabsContent value="log">
            <LogTab />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
