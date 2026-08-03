import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { Button } from '@renderer/components/ui'
import { dbStatsQueryOptions } from '@renderer/lib/api/db'

/**
 * Converts a byte count to a human-readable value using byte, kilobyte, megabyte, or gigabyte units.
 *
 * @param bytes - The number of bytes to format
 * @returns The formatted byte value rounded to one decimal place
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

/**
 * Displays database statistics and provides a control to refresh them.
 *
 * @returns The database statistics view, a loading state, or an error message
 */
export function DbStats() {
  const { data: stats, error, isFetching, refetch } = useQuery(dbStatsQueryOptions)

  const message = error ? (error instanceof Error ? error.message : 'Failed to load stats') : null

  // Only a first load with nothing cached takes over the panel. A refresh that
  // fails leaves the numbers it already had on screen, under a banner — they
  // are still the last figures the database reported.
  if (!stats) {
    if (message) {
      return <div className="rounded-lg bg-red-900/20 p-4 text-sm text-red-400">{message}</div>
    }
    return <div className="text-sm text-text-muted">Loading stats...</div>
  }

  return (
    <div className="space-y-4">
      {message && (
        <div className="rounded-lg bg-red-900/20 p-3 text-sm text-red-400">{message}</div>
      )}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Database Statistics</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="gap-1"
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </Button>
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
