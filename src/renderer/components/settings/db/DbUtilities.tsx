import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ConfirmDialog } from '@renderer/components/settings/db/ConfirmDialog'
import type { OrphanReport } from '@shared/ipc'
import { Button } from '@renderer/components/ui'
import { dbSnapshotsQueryOptions, useDbAdminMutations } from '@renderer/lib/api/db'
import { formatRelativeTime } from '@renderer/lib/formatRelativeTime'

const EXPORT_TABLES = [
  'cases',
  'captures',
  'tags',
  'capture_tags',
  'selectors',
  'selector_matches',
  'capture_favorites',
  'notes'
] as const

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

interface UtilityResult {
  message: string
  type: 'success' | 'error'
}

export function DbUtilities() {
  const {
    vacuum,
    rebuildFts,
    purgeArchived,
    findOrphans,
    cleanOrphans,
    backup,
    restore,
    restoreSnapshot,
    exportTable: exportTableMutation
  } = useDbAdminMutations()
  const { data: snapshots = [] } = useQuery(dbSnapshotsQueryOptions)
  const [loading, setLoading] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, UtilityResult>>({})
  const [confirm, setConfirm] = useState<{
    open: boolean
    key: string
    title: string
    message: string
    action: () => Promise<void>
  }>({ open: false, key: '', title: '', message: '', action: async () => {} })

  // Orphan state
  const [orphanReport, setOrphanReport] = useState<OrphanReport | null>(null)

  // Export state
  const [exportTable, setExportTable] = useState('cases')
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv')

  function setResult(key: string, result: UtilityResult) {
    setResults((prev) => ({ ...prev, [key]: result }))
  }

  async function handleVacuum() {
    setLoading('vacuum')
    try {
      const result = await vacuum.mutateAsync()
      setResult('vacuum', {
        message: `Vacuum complete. Freed ${formatBytes(result.freedBytes)}.`,
        type: 'success'
      })
    } catch (err) {
      setResult('vacuum', {
        message: err instanceof Error ? err.message : 'Vacuum failed',
        type: 'error'
      })
    } finally {
      setLoading(null)
    }
  }

  async function handleRebuildFts() {
    setLoading('fts')
    try {
      const result = await rebuildFts.mutateAsync()
      setResult('fts', {
        message:
          `Rebuilt FTS indexes. ${result.rowsIndexed} rows indexed, ` +
          `${result.textsHealed} text(s) healed from disk.`,
        type: 'success'
      })
    } catch (err) {
      setResult('fts', {
        message: err instanceof Error ? err.message : 'FTS rebuild failed',
        type: 'error'
      })
    } finally {
      setLoading(null)
    }
  }

  async function handlePurge() {
    setLoading('purge')
    try {
      const result = await purgeArchived.mutateAsync()
      setResult('purge', {
        message: `Purged ${result.casesDeleted} case(s) and ${result.capturesDeleted} capture(s).`,
        type: 'success'
      })
    } catch (err) {
      setResult('purge', {
        message: err instanceof Error ? err.message : 'Purge failed',
        type: 'error'
      })
    } finally {
      setLoading(null)
    }
  }

  async function handleScanOrphans() {
    setLoading('orphans')
    try {
      const report = await findOrphans.mutateAsync()
      setOrphanReport(report)
      const total = report.dbOrphans.length + report.fileOrphans.length
      setResult('orphans', {
        message:
          total === 0
            ? 'No orphans found.'
            : `Found ${report.dbOrphans.length} DB orphan(s) and ${report.fileOrphans.length} file orphan(s).`,
        type: total === 0 ? 'success' : 'error'
      })
    } catch (err) {
      setResult('orphans', {
        message: err instanceof Error ? err.message : 'Scan failed',
        type: 'error'
      })
    } finally {
      setLoading(null)
    }
  }

  async function handleCleanOrphans() {
    if (!orphanReport) return
    setLoading('orphans-clean')
    try {
      const result = await cleanOrphans.mutateAsync(orphanReport)
      setOrphanReport(null)
      setResult('orphans', {
        message: `Cleaned ${result.dbRecordsRemoved} DB record(s) and ${result.filesRemoved} file(s).`,
        type: 'success'
      })
    } catch (err) {
      setResult('orphans', {
        message: err instanceof Error ? err.message : 'Clean failed',
        type: 'error'
      })
    } finally {
      setLoading(null)
    }
  }

  async function handleBackup() {
    setLoading('backup')
    try {
      const result = await backup.mutateAsync()
      if (result) {
        setResult('backup', {
          message: `Backup saved to ${result.path}`,
          type: 'success'
        })
      } else {
        setResult('backup', { message: 'Backup cancelled.', type: 'success' })
      }
    } catch (err) {
      setResult('backup', {
        message: err instanceof Error ? err.message : 'Backup failed',
        type: 'error'
      })
    } finally {
      setLoading(null)
    }
  }

  async function handleRestore() {
    setLoading('restore')
    try {
      const result = await restore.mutateAsync()
      if (result.restored) {
        setResult('restore', {
          message: 'Database restored. Please restart the app for full effect.',
          type: 'success'
        })
      } else {
        setResult('restore', { message: 'Restore cancelled.', type: 'success' })
      }
    } catch (err) {
      setResult('restore', {
        message: err instanceof Error ? err.message : 'Restore failed',
        type: 'error'
      })
    } finally {
      setLoading(null)
    }
  }

  async function handleRestoreSnapshot(fileName: string) {
    // Keyed by file so only the row being restored says so. The result still
    // belongs to the card, which is why setResult keeps the plain key.
    setLoading(`snapshots:${fileName}`)
    try {
      await restoreSnapshot.mutateAsync(fileName)
      setResult('snapshots', {
        message:
          `Restored ${fileName}. The database was re-opened and brought back up to the ` +
          'current schema. Please restart the app for full effect.',
        type: 'success'
      })
    } catch (err) {
      setResult('snapshots', {
        message: err instanceof Error ? err.message : 'Snapshot restore failed',
        type: 'error'
      })
    } finally {
      setLoading(null)
    }
  }

  async function handleExport() {
    setLoading('export')
    try {
      const result = await exportTableMutation.mutateAsync({
        table: exportTable,
        format: exportFormat
      })
      if (result) {
        setResult('export', {
          message: `Exported to ${result.path}`,
          type: 'success'
        })
      } else {
        setResult('export', { message: 'Export cancelled.', type: 'success' })
      }
    } catch (err) {
      setResult('export', {
        message: err instanceof Error ? err.message : 'Export failed',
        type: 'error'
      })
    } finally {
      setLoading(null)
    }
  }

  function UtilCard({
    id,
    title,
    description,
    children
  }: {
    id: string
    title: string
    description: string
    children: React.ReactNode
  }) {
    const result = results[id]
    return (
      <div className="rounded-lg border border-border p-4">
        <div className="mb-1 text-sm font-semibold text-text-primary">{title}</div>
        <p className="mb-3 text-xs text-text-muted">{description}</p>
        <div className="flex items-center gap-3">{children}</div>
        {result && (
          <div
            className={`mt-2 text-xs ${
              result.type === 'success' ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {result.message}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <UtilCard
        id="vacuum"
        title="Vacuum & Optimize"
        description="Reclaim unused space and optimize query performance."
      >
        <Button variant="outline" size="sm" onClick={handleVacuum} disabled={loading !== null}>
          {loading === 'vacuum' ? 'Running...' : 'Run Vacuum'}
        </Button>
      </UtilCard>

      <UtilCard
        id="fts"
        title="Rebuild FTS Indexes"
        description="Drop and rebuild full-text search indexes for captures and notes."
      >
        <Button variant="outline" size="sm" onClick={handleRebuildFts} disabled={loading !== null}>
          {loading === 'fts' ? 'Rebuilding...' : 'Rebuild'}
        </Button>
      </UtilCard>

      <UtilCard
        id="purge"
        title="Purge Archived Cases"
        description="Permanently delete all archived cases and their captures from the database."
      >
        <button
          onClick={() =>
            setConfirm({
              open: true,
              key: 'purge',
              title: 'Purge Archived Cases',
              message:
                'This will permanently delete ALL archived cases, their captures, tags, selectors, and notes. This cannot be undone.',
              action: handlePurge
            })
          }
          disabled={loading !== null}
          className="rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 disabled:opacity-50"
        >
          Purge
        </button>
      </UtilCard>

      <UtilCard
        id="orphans"
        title="Find & Clean Orphans"
        description="Scan for DB records with missing files and files with no DB record."
      >
        <Button variant="outline" size="sm" onClick={handleScanOrphans} disabled={loading !== null}>
          {loading === 'orphans' ? 'Scanning...' : 'Scan'}
        </Button>
        {orphanReport &&
          (orphanReport.dbOrphans.length > 0 || orphanReport.fileOrphans.length > 0) && (
            <button
              onClick={() =>
                setConfirm({
                  open: true,
                  key: 'orphans-clean',
                  title: 'Clean Orphans',
                  message: `This will remove ${orphanReport.dbOrphans.length} orphaned DB record(s) and ${orphanReport.fileOrphans.length} orphaned file(s). This cannot be undone.`,
                  action: handleCleanOrphans
                })
              }
              disabled={loading !== null}
              className="rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 disabled:opacity-50"
            >
              {loading === 'orphans-clean' ? 'Cleaning...' : 'Clean'}
            </button>
          )}
      </UtilCard>

      <UtilCard
        id="backup"
        title="Backup Database"
        description="Copy the database file to a location of your choice."
      >
        <Button variant="outline" size="sm" onClick={handleBackup} disabled={loading !== null}>
          {loading === 'backup' ? 'Saving...' : 'Create Backup'}
        </Button>
      </UtilCard>

      <UtilCard
        id="restore"
        title="Restore Database"
        description="Replace the current database with a backup file. Requires app restart."
      >
        <button
          onClick={() =>
            setConfirm({
              open: true,
              key: 'restore',
              title: 'Restore Database',
              message:
                'This will replace your current database with the selected backup file. All current data will be lost. The app will need to be restarted.',
              action: handleRestore
            })
          }
          disabled={loading !== null}
          className="rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 disabled:opacity-50"
        >
          Restore from File
        </button>
      </UtilCard>

      <UtilCard
        id="snapshots"
        title="Pre-Migration Snapshots"
        description="Copies taken automatically before Birdbrain upgrades the database schema. Restoring one brings back the records that copy holds — the schema itself is then upgraded again, so this recovers contents, not the old schema."
      >
        <div className="w-full space-y-2">
          {snapshots.length === 0 && (
            <p className="text-xs text-text-muted">
              No snapshots yet — one is written the next time an upgrade changes the schema.
            </p>
          )}
          {snapshots.map((snapshot) => (
            <div
              key={snapshot.fileName}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-xs text-text-primary">
                  Schema v{snapshot.fromVersion} → v{snapshot.toVersion}
                </div>
                <div className="truncate text-xs text-text-muted">
                  {formatRelativeTime(snapshot.createdAt)} · {formatBytes(snapshot.sizeBytes)} ·{' '}
                  {snapshot.fileName}
                </div>
              </div>
              <button
                onClick={() =>
                  setConfirm({
                    open: true,
                    key: 'restore-snapshot',
                    title: 'Restore Snapshot',
                    message:
                      `This will replace your current database with the copy taken before the ` +
                      `upgrade to schema v${snapshot.toVersion}. It cannot be undone: the current ` +
                      `database is overwritten, and Birdbrain does not keep a copy of it. If you ` +
                      `might want it back, cancel and use Backup Database above first. ` +
                      `Everything recorded since the snapshot disappears from the app; capture ` +
                      `files stay on disk, no longer referenced by anything. Birdbrain re-applies ` +
                      `the schema upgrade to the restored copy as it re-opens it, so you end up ` +
                      `on the current schema holding the older records — not back on schema ` +
                      `v${snapshot.fromVersion}. If the restore fails, treat the result as ` +
                      `unknown: a restore error does not prove the previous database is still ` +
                      `intact, and case data can be left inconsistent — check the case before ` +
                      `carrying on, or restore a backup.`,
                    action: () => handleRestoreSnapshot(snapshot.fileName)
                  })
                }
                disabled={loading !== null}
                className="shrink-0 rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 disabled:opacity-50"
              >
                {loading === `snapshots:${snapshot.fileName}` ? 'Restoring...' : 'Restore'}
              </button>
            </div>
          ))}
        </div>
      </UtilCard>

      <UtilCard
        id="export"
        title="Export Table"
        description="Export a table's contents to CSV or JSON."
      >
        <select
          value={exportTable}
          onChange={(e) => setExportTable(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-primary outline-none"
        >
          {EXPORT_TABLES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={exportFormat}
          onChange={(e) => setExportFormat(e.target.value as 'csv' | 'json')}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-primary outline-none"
        >
          <option value="csv">CSV</option>
          <option value="json">JSON</option>
        </select>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={loading !== null}>
          {loading === 'export' ? 'Exporting...' : 'Export'}
        </Button>
      </UtilCard>

      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        confirmLabel={confirm.key.startsWith('restore') ? 'Restore' : 'Delete'}
        onConfirm={async () => {
          setConfirm((c) => ({ ...c, open: false }))
          await confirm.action()
        }}
        onCancel={() => setConfirm((c) => ({ ...c, open: false }))}
      />
    </div>
  )
}
