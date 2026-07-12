import { useState } from 'react'
import { ConfirmDialog } from '@renderer/components/settings/db/ConfirmDialog'
import { Button } from '@renderer/components/ui'
import { useDbAdminMutations } from '@renderer/lib/api/db'

const EXPORT_TABLES = [
  'cases',
  'captures',
  'tags',
  'capture_tags',
  'selectors',
  'selector_matches',
  'capture_favorites',
  'notes',
  'captures_fts',
  'notes_fts'
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
    exportTable
  } = useDbAdminMutations()

  const [results, setResults] = useState<Record<string, UtilityResult>>({})
  const [confirm, setConfirm] = useState<{
    open: boolean
    key: string
    title: string
    message: string
    action: () => Promise<void>
  }>({ open: false, key: '', title: '', message: '', action: async () => {} })

  // Orphan state
  const orphanReport = findOrphans.data ?? null

  // Export state
  const [exportTableName, setExportTableName] = useState('cases')
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv')

  const anyPending =
    vacuum.isPending ||
    rebuildFts.isPending ||
    purgeArchived.isPending ||
    findOrphans.isPending ||
    cleanOrphans.isPending ||
    backup.isPending ||
    restore.isPending ||
    exportTable.isPending

  function setResult(key: string, result: UtilityResult) {
    setResults((prev) => ({ ...prev, [key]: result }))
  }

  async function handleVacuum() {
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
    }
  }

  async function handleRebuildFts() {
    try {
      const result = await rebuildFts.mutateAsync()
      setResult('fts', {
        message: `Rebuilt FTS indexes. ${result.rowsIndexed} rows indexed.`,
        type: 'success'
      })
    } catch (err) {
      setResult('fts', {
        message: err instanceof Error ? err.message : 'FTS rebuild failed',
        type: 'error'
      })
    }
  }

  async function handlePurge() {
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
    }
  }

  async function handleScanOrphans() {
    try {
      const report = await findOrphans.mutateAsync()
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
    }
  }

  async function handleCleanOrphans() {
    if (!orphanReport) return
    try {
      const result = await cleanOrphans.mutateAsync(orphanReport)
      findOrphans.reset()
      setResult('orphans', {
        message: `Cleaned ${result.dbRecordsRemoved} DB record(s) and ${result.filesRemoved} file(s).`,
        type: 'success'
      })
    } catch (err) {
      setResult('orphans', {
        message: err instanceof Error ? err.message : 'Clean failed',
        type: 'error'
      })
    }
  }

  async function handleBackup() {
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
    }
  }

  async function handleRestore() {
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
    }
  }

  async function handleExport() {
    try {
      const result = await exportTable.mutateAsync({
        table: exportTableName,
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
        <Button variant="outline" size="sm" onClick={handleVacuum} disabled={anyPending}>
          {vacuum.isPending ? 'Running...' : 'Run Vacuum'}
        </Button>
      </UtilCard>

      <UtilCard
        id="fts"
        title="Rebuild FTS Indexes"
        description="Drop and rebuild full-text search indexes for captures and notes."
      >
        <Button variant="outline" size="sm" onClick={handleRebuildFts} disabled={anyPending}>
          {rebuildFts.isPending ? 'Rebuilding...' : 'Rebuild'}
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
          disabled={anyPending}
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
        <Button variant="outline" size="sm" onClick={handleScanOrphans} disabled={anyPending}>
          {findOrphans.isPending ? 'Scanning...' : 'Scan'}
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
              disabled={anyPending}
              className="rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 disabled:opacity-50"
            >
              {cleanOrphans.isPending ? 'Cleaning...' : 'Clean'}
            </button>
          )}
      </UtilCard>

      <UtilCard
        id="backup"
        title="Backup Database"
        description="Copy the database file to a location of your choice."
      >
        <Button variant="outline" size="sm" onClick={handleBackup} disabled={anyPending}>
          {backup.isPending ? 'Saving...' : 'Create Backup'}
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
          disabled={anyPending}
          className="rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 disabled:opacity-50"
        >
          Restore from File
        </button>
      </UtilCard>

      <UtilCard
        id="export"
        title="Export Table"
        description="Export a table's contents to CSV or JSON."
      >
        <select
          value={exportTableName}
          onChange={(e) => setExportTableName(e.target.value)}
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
        <Button variant="outline" size="sm" onClick={handleExport} disabled={anyPending}>
          {exportTable.isPending ? 'Exporting...' : 'Export'}
        </Button>
      </UtilCard>

      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        confirmLabel={confirm.key === 'restore' ? 'Restore' : 'Delete'}
        onConfirm={async () => {
          setConfirm((c) => ({ ...c, open: false }))
          await confirm.action()
        }}
        onCancel={() => setConfirm((c) => ({ ...c, open: false }))}
      />
    </div>
  )
}
