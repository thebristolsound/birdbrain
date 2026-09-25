import { useState } from 'react'
import { Button } from '@renderer/components/ui'
import { useDbAdminMutations } from '@renderer/lib/api/db'

export function DbMaintenance() {
  const { vacuum, rebuildFts, integrityCheck } = useDbAdminMutations()
  const [result, setResult] = useState<{ ok: boolean; message: string; issues?: string[] } | null>(
    null
  )
  const busy = vacuum.isPending || rebuildFts.isPending || integrityCheck.isPending

  async function run(action: 'vacuum' | 'fts' | 'integrity') {
    setResult(null)
    try {
      if (action === 'vacuum') {
        const { freedBytes } = await vacuum.mutateAsync()
        setResult({
          ok: true,
          message: `Vacuum complete. Freed ${freedBytes.toLocaleString()} bytes.`
        })
      } else if (action === 'fts') {
        const { rowsIndexed, textsHealed } = await rebuildFts.mutateAsync()
        setResult({
          ok: true,
          message: `Rebuilt FTS indexes. ${rowsIndexed} rows indexed, ${textsHealed} text(s) healed from disk.`
        })
      } else {
        const check = await integrityCheck.mutateAsync()
        setResult({
          ok: check.ok,
          message: check.ok
            ? 'SQLite integrity and foreign-key checks passed.'
            : 'SQLite integrity check found problems.',
          issues: check.issues
        })
      }
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : 'Database check or maintenance failed.'
      })
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => run('vacuum')}>
          {vacuum.isPending ? 'Running…' : 'Vacuum'}
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => run('fts')}>
          {rebuildFts.isPending ? 'Rebuilding…' : 'Rebuild FTS index'}
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => run('integrity')}>
          {integrityCheck.isPending ? 'Checking…' : 'Integrity check'}
        </Button>
      </div>
      <p className="text-xs text-text-muted">
        Integrity check inspects database structure and foreign keys. It does not verify capture
        files, manifests or timestamps, and makes no repairs.
      </p>
      {result && (
        <div
          role="status"
          className={result.ok ? 'text-xs text-text-muted' : 'text-xs text-red-500'}
        >
          <p>{result.message}</p>
          {result.issues && result.issues.length > 0 && (
            <ul className="mt-1 list-inside list-disc">
              {result.issues.map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
