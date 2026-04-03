import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  caseQueryOptions,
  capturesQueryOptions,
  tagCountForCaseQueryOptions,
  selectorCoverageQueryOptions,
  useCasesMutations
} from '@renderer/lib/queries'
import { ExportDialog } from '@renderer/components/export/ExportDialog'
import { Camera, Globe, Tags, FileOutput, Crosshair, Pencil } from 'lucide-react'

export function CaseOverview() {
  const { caseId } = useParams({ strict: false })
  const { data: caseData } = useQuery(caseQueryOptions(caseId!))
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId!))
  const { data: tagCount = 0 } = useQuery(tagCountForCaseQueryOptions(caseId!))
  const { data: selectorCoverage = { matched: 0, total: 0 } } = useQuery(
    selectorCoverageQueryOptions(caseId!)
  )
  const { update } = useCasesMutations()
  const [showExport, setShowExport] = useState(false)

  // Editable name state
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Editable description state
  const [editingDesc, setEditingDesc] = useState(false)
  const [descValue, setDescValue] = useState('')
  const descInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (caseData) {
      setNameValue(caseData.name)
      setDescValue(caseData.description ?? '')
    }
  }, [caseData])

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [editingName])

  useEffect(() => {
    if (editingDesc && descInputRef.current) {
      descInputRef.current.focus()
    }
  }, [editingDesc])

  async function saveName() {
    if (!caseData) return
    const trimmed = nameValue.trim()
    if (!trimmed || trimmed === caseData.name) {
      setNameValue(caseData.name)
      setEditingName(false)
      return
    }
    await update.mutateAsync({ id: caseData.id, name: trimmed })
    setEditingName(false)
  }

  async function saveDesc() {
    if (!caseData) return
    const trimmed = descValue.trim()
    if (trimmed === (caseData.description ?? '')) {
      setEditingDesc(false)
      return
    }
    await update.mutateAsync({ id: caseData.id, description: trimmed })
    setEditingDesc(false)
  }

  if (!caseData) {
    return <div className="text-text-muted">Loading case...</div>
  }

  const { topDomains, dateRange } = useMemo(() => {
    const domainCounts: Record<string, number> = {}
    for (const cap of captures) {
      try {
        const domain = new URL(cap.url).hostname
        domainCounts[domain] = (domainCounts[domain] || 0) + 1
      } catch {
        // skip invalid URLs
      }
    }
    const topDomains = Object.entries(domainCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    const dateRange =
      captures.length > 0
        ? { first: captures[captures.length - 1].timestamp, last: captures[0].timestamp }
        : null

    return { topDomains, dateRange }
  }, [captures])

  return (
    <div className="flex gap-6">
      {/* Main content */}
      <div className="min-w-0 flex-1 space-y-6">
        {/* Editable case name and description */}
        <div>
          {editingName ? (
            <input
              ref={nameInputRef}
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName()
                if (e.key === 'Escape') {
                  setNameValue(caseData.name)
                  setEditingName(false)
                }
              }}
              className="w-full rounded border border-accent bg-elevated px-2 py-1 font-display text-2xl font-extrabold text-text-primary focus:outline-none"
            />
          ) : (
            <h1
              className="group cursor-pointer font-display text-2xl font-extrabold text-text-primary"
              title="Click to edit"
              onClick={() => setEditingName(true)}
            >
              {caseData.name}
              <Pencil className="ml-2 inline-block h-4 w-4 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
            </h1>
          )}

          {editingDesc ? (
            <textarea
              ref={descInputRef}
              value={descValue}
              onChange={(e) => setDescValue(e.target.value)}
              onBlur={saveDesc}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setDescValue(caseData.description ?? '')
                  setEditingDesc(false)
                }
              }}
              rows={3}
              className="mt-1 w-full resize-none rounded border border-accent bg-elevated px-2 py-1 text-sm text-text-secondary focus:outline-none"
            />
          ) : (
            <p
              className="mt-1 cursor-pointer text-text-muted hover:text-text-secondary"
              title="Click to edit"
              onClick={() => setEditingDesc(true)}
            >
              {caseData.description || (
                <span className="italic text-text-faint">Add a description...</span>
              )}
            </p>
          )}

          {dateRange && (
            <p className="mt-1 font-mono text-xs text-text-faint">
              {new Date(dateRange.first).toLocaleDateString()} —{' '}
              {new Date(dateRange.last).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="neu-card rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-subtle">
                <Camera className="h-5 w-5 text-accent" />
              </div>
              <div>
                <div className="text-2xl font-bold text-text-primary">{captures.length}</div>
                <div className="text-sm text-text-muted">Captures</div>
              </div>
            </div>
          </div>
          <div className="neu-card rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-subtle">
                <Globe className="h-5 w-5 text-accent" />
              </div>
              <div>
                <div className="text-2xl font-bold text-text-primary">{topDomains.length}</div>
                <div className="text-sm text-text-muted">Domains</div>
              </div>
            </div>
          </div>
          <div className="neu-card rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-subtle">
                <Tags className="h-5 w-5 text-accent" />
              </div>
              <div>
                <div className="text-2xl font-bold text-text-primary">{tagCount}</div>
                <div className="text-sm text-text-muted">Tags</div>
              </div>
            </div>
          </div>
        </div>

        {/* Capture Timeline */}
        {captures.length > 0 && (
          <div>
            <h2 className="mb-3 text-lg font-semibold text-text-primary">Capture Timeline</h2>
            <div className="neu-card flex h-8 gap-px overflow-hidden rounded-2xl">
              {captures.slice(0, 50).map((cap) => (
                <div
                  key={cap.id}
                  className="flex-1 bg-accent-subtle hover:bg-accent-hover"
                  title={`${cap.title}\n${new Date(cap.timestamp).toLocaleString()}`}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right sidebar */}
      <div className="w-80 shrink-0 space-y-4">
        {/* Quick Actions */}
        <div className="neu-card rounded-2xl p-4">
          <h3 className="mb-3 text-sm font-semibold text-text-secondary">Quick Actions</h3>
          <div className="space-y-2">
            <button
              onClick={() => setShowExport(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border-strong bg-elevated py-2.5 text-sm font-medium text-text-secondary hover:bg-elevated"
            >
              <FileOutput className="h-4 w-4" />
              Export Report
            </button>
          </div>
        </div>

        {/* Top Domains */}
        {topDomains.length > 0 && (
          <div className="neu-card rounded-2xl p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-secondary">Top Domains</h3>
            <div className="space-y-2">
              {topDomains.map(([domain, count]) => (
                <div key={domain} className="flex items-center gap-2">
                  <Globe className="h-4 w-4 shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate font-mono text-sm text-text-secondary">
                    {domain}
                  </span>
                  <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-xs text-text-muted">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Coverage */}
        <div className="neu-card rounded-2xl p-4">
          <div className="mb-3 flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-text-secondary">Coverage</h3>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-text-muted">Selector Coverage</span>
              <span className="text-text-muted">
                {selectorCoverage.total > 0
                  ? Math.round((selectorCoverage.matched / selectorCoverage.total) * 100)
                  : 0}
                %
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{
                  width:
                    selectorCoverage.total > 0
                      ? `${Math.round((selectorCoverage.matched / selectorCoverage.total) * 100)}%`
                      : '0%'
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {showExport && caseData && (
        <ExportDialog
          caseId={caseData.id}
          caseName={caseData.name}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  )
}
