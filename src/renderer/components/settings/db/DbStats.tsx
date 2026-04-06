import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import type { DbStats as DbStatsType } from '@shared/ipc'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export function DbStats() {
  const [stats, setStats] = useState<DbStatsType | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchStats() {
    setLoading(true)
    setError(null)
    try {
      const data = await window.birdbrain.db.stats()
      setStats(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStats()
  }, [])

  if (error) {
    return <div className="rounded-lg bg-red-900/20 p-4 text-sm text-red-400">{error}</div>
  }

  if (!stats) {
    return <div className="text-sm text-text-muted">Loading stats...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Database Statistics</h3>
        <button
          onClick={fetchStats}
          disabled={loading}
          className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-elevated disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-elevated p-3">
          <div className="text-[11px] text-text-muted">Schema Version</div>
          <div className="text-lg font-semibold text-text-primary">v{stats.schemaVersion}</div>
        </div>
        <div className="rounded-lg border border-border bg-elevated p-3">
          <div className="text-[11px] text-text-muted">DB File Size</div>
          <div className="text-lg font-semibold text-text-primary">
            {formatBytes(stats.dbFileSize)}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-elevated p-3">
          <div className="text-[11px] text-text-muted">WAL Size</div>
          <div className="text-lg font-semibold text-text-primary">
            {formatBytes(stats.walFileSize)}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">Table</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-text-muted">Rows</th>
            </tr>
          </thead>
          <tbody>
            {stats.tables.map((t) => (
              <tr key={t.name} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2 font-mono text-xs text-text-primary">{t.name}</td>
                <td className="px-3 py-2 text-right font-mono text-xs text-text-muted">
                  {t.rowCount.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
