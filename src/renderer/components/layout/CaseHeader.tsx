import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@renderer/components/ui'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import { ChevronDown, Camera, Globe, Tags, Pencil, FileOutput } from 'lucide-react'
import {
  caseQueryOptions,
  capturesQueryOptions,
  tagCountForCaseQueryOptions,
  useCasesMutations
} from '@renderer/lib/queries'
import { ExportDialog } from '@renderer/components/export/ExportDialog'
import { presets } from '@renderer/lib/motion'

export function CaseHeader() {
  const { caseId } = useParams({ strict: false }) as { caseId?: string }
  const { data: caseData } = useQuery({
    ...caseQueryOptions(caseId ?? ''),
    enabled: !!caseId
  })
  const { data: captures = [] } = useQuery({
    ...capturesQueryOptions(caseId ?? ''),
    enabled: !!caseId
  })
  const { data: tagCount = 0 } = useQuery({
    ...tagCountForCaseQueryOptions(caseId ?? ''),
    enabled: !!caseId
  })
  const { update } = useCasesMutations()

  const [expanded, setExpanded] = useState(false)
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

  const { domainCount, dateRange } = useMemo(() => {
    const domains = new Set<string>()
    let earliest: string | null = null
    let latest: string | null = null

    for (const cap of captures) {
      try {
        const hostname = new URL(cap.url).hostname
        if (hostname) domains.add(hostname)
      } catch {
        // skip invalid URLs
      }
      if (!earliest || cap.timestamp < earliest) earliest = cap.timestamp
      if (!latest || cap.timestamp > latest) latest = cap.timestamp
    }

    const dateRange =
      earliest && latest
        ? {
            first: earliest,
            last: latest
          }
        : null

    return { domainCount: domains.size, dateRange }
  }, [captures])

  if (!caseId) return null

  function formatDate(ts: string) {
    return new Date(ts).toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric'
    })
  }

  return (
    <div className="shrink-0 border-b border-border bg-surface">
      {/* Collapsed bar — always visible */}
      <div className="flex items-center gap-3 px-5 py-2.5">
        {/* Chevron toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="h-6 w-6 rounded text-text-muted hover:bg-elevated flex items-center justify-center"
          aria-label={expanded ? 'Collapse case header' : 'Expand case header'}
        >
          <ChevronDown
            size={14}
            strokeWidth={2}
            style={{
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 200ms ease'
            }}
          />
        </button>

        {/* Editable case name */}
        <div className="flex min-w-0 flex-1 items-center">
          {editingName ? (
            <input
              data-testid="case-header-name-input"
              ref={nameInputRef}
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName()
                if (e.key === 'Escape') {
                  setNameValue(caseData?.name ?? '')
                  setEditingName(false)
                }
              }}
              className="rounded border border-accent bg-elevated px-2 py-0.5 font-display text-sm font-bold text-text-primary focus:outline-none"
            />
          ) : (
            <button
              data-testid="case-header-name-btn"
              className="group flex min-w-0 items-center gap-1.5"
              onClick={() => setEditingName(true)}
              title="Click to edit"
            >
              <span className="truncate font-display text-sm font-bold text-text-primary">
                {caseData?.name ?? ''}
              </span>
              <Pencil
                size={11}
                className="shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100"
              />
            </button>
          )}
        </div>

        {/* Stat badges */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Camera size={14} strokeWidth={1.8} className="h-3.5 w-3.5 text-text-muted" />
            <span className="text-xs text-text-muted">{captures.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <Globe size={14} strokeWidth={1.8} className="h-3.5 w-3.5 text-text-muted" />
            <span className="text-xs text-text-muted">{domainCount}</span>
          </div>
          <div className="flex items-center gap-1">
            <Tags size={14} strokeWidth={1.8} className="h-3.5 w-3.5 text-text-muted" />
            <span className="text-xs text-text-muted">{tagCount}</span>
          </div>
        </div>

        {/* Export button */}
        <Button variant="outline" size="sm" onClick={() => setShowExport(true)} className="gap-1.5">
          <FileOutput size={12} strokeWidth={1.8} />
          Export
        </Button>
      </div>

      {/* Expanded section */}
      <AnimatePresence>
        {expanded && (
          <motion.div {...presets.collapse} className="overflow-hidden">
            <div className="border-t border-border px-5 py-3 space-y-2">
              {/* Editable description */}
              {editingDesc ? (
                <textarea
                  ref={descInputRef}
                  value={descValue}
                  onChange={(e) => setDescValue(e.target.value)}
                  onBlur={saveDesc}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setDescValue(caseData?.description ?? '')
                      setEditingDesc(false)
                    }
                  }}
                  rows={2}
                  className="w-full resize-none rounded border border-accent bg-elevated px-2 py-1 text-sm text-text-secondary focus:outline-none"
                />
              ) : (
                <p
                  className="cursor-pointer text-sm text-text-secondary hover:text-text-primary"
                  onClick={() => setEditingDesc(true)}
                  title="Click to edit"
                >
                  {caseData?.description ? (
                    caseData.description
                  ) : (
                    <span className="italic text-text-faint">Add a description...</span>
                  )}
                </p>
              )}

              {/* Date range */}
              {dateRange && (
                <p className="font-mono text-xs text-text-muted">
                  {formatDate(dateRange.first)} &mdash; {formatDate(dateRange.last)}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Export dialog */}
      <AnimatePresence>
        {showExport && caseData && (
          <ExportDialog
            caseId={caseData.id}
            caseName={caseData.name}
            onClose={() => setShowExport(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
