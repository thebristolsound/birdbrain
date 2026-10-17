import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Inbox } from 'lucide-react'
import {
  UNREVIEWED_GROUPS,
  type UnreviewedCapture,
  type UnreviewedGroup,
  type UnreviewedRow
} from '@shared/types'
import { Badge, Button, Input } from '@renderer/components/ui'
import { Column, DirRow, EmptyState } from '@renderer/components/data/IndicatorsView'
import { unreviewedCapturesQueryOptions } from '@renderer/lib/api/cases'
import { useAppStore } from '@renderer/stores/appStore'

// The unreviewed view (docs/plans/2026-10-09-case-retrieval-first-slice.md, D8, Rulings 1
// and 3): the Captures no note names and no Selector matched, in four groups, laid out in
// the extracted-data view's columns because it groups the same identifiers. A header or
// link row opens its Capture at the record, as a search hit opens; a rare identifier has
// no locator, so it opens the Capture only.

// Ruling 3. Held in the view and never stored, so the view opens at 2 each time.
export const DEFAULT_RARE_LIMIT = 2

const GROUP_LABELS: Record<UnreviewedGroup, string> = {
  from: 'From',
  'reply-to': 'Reply-To',
  'link-host': 'Link host',
  rare: 'Rare identifiers'
}

function captures(count: number): string {
  return `${count.toLocaleString()} capture${count === 1 ? '' : 's'}`
}

function rowId(row: UnreviewedRow): string {
  return row.identifier
    ? `${row.identifier.category}\u0000${row.identifier.subcategory}\u0000${row.key}`
    : row.key
}

// What the counts beside the total mean for the groups; each sentence only when its
// count is not 0.
export function unreviewedNotes({
  ungrouped,
  notCurrent,
  partial
}: {
  ungrouped: number
  notCurrent: number
  partial: number
}): string[] {
  const notes: string[] = []
  if (ungrouped > 0) {
    notes.push(
      `${ungrouped.toLocaleString()} of them ${ungrouped === 1 ? 'is' : 'are'} in no group.`
    )
  }
  if (notCurrent > 0) {
    notes.push(
      notCurrent === 1
        ? '1 has no current link and header records, so it is not in the From, Reply-To or link host groups.'
        : `${notCurrent.toLocaleString()} have no current link and header records, so they are not in the From, Reply-To or link host groups.`
    )
  }
  if (partial > 0) {
    notes.push(
      partial === 1
        ? '1 has link and header records that a size limit cut short, so those groups may leave some of its values out.'
        : `${partial.toLocaleString()} have link and header records that a size limit cut short, so those groups may leave some of their values out.`
    )
  }
  return notes
}

export function UnreviewedView({
  caseId,
  onTotal
}: {
  caseId: string
  // The rail's count for the view's row.
  onTotal?: (total: number) => void
}) {
  const [rareLimit, setRareLimit] = useState(DEFAULT_RARE_LIMIT)
  const [limitText, setLimitText] = useState(String(DEFAULT_RARE_LIMIT))
  const [group, setGroup] = useState<UnreviewedGroup>('from')
  const [picked, setPicked] = useState<string | null>(null)
  const navigate = useNavigate()
  const selectCapture = useAppStore((s) => s.selectCapture)
  const setViewerHit = useAppStore((s) => s.setViewerHit)
  const setActiveViewerTab = useAppStore((s) => s.setActiveViewerTab)

  const { data, isLoading, isError, error, refetch, isPlaceholderData } = useQuery(
    unreviewedCapturesQueryOptions(caseId, rareLimit)
  )

  useEffect(() => {
    if (data && !isPlaceholderData) onTotal?.(data.total)
  }, [data, isPlaceholderData, onTotal])

  function changeLimit(text: string) {
    setLimitText(text)
    const value = Number(text)
    // Anything but a whole number of at least 1 keeps the last limit; nothing is sent.
    if (text.trim() !== '' && Number.isInteger(value) && value >= 1) setRareLimit(value)
  }

  // As a search hit opens (SearchBar), or with no hit for a rare identifier: selecting a
  // Capture keeps a hit already set for it, so the hit is always replaced.
  function open(capture: UnreviewedCapture) {
    selectCapture(capture.exhibitId)
    setViewerHit(capture.hit)
    if (capture.hit) {
      setActiveViewerTab(capture.hit.locator.source === 'text' ? 'text' : 'links')
    }
    void navigate({ to: '/cases/$caseId/captures', params: { caseId } })
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        Loading unreviewed captures…
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-9 text-center">
        <div className="text-xs text-danger-fg" data-testid="unreviewed-error">
          Failed to load the unreviewed captures:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const rows = data.groups[group]
  const row = rows.find((candidate) => rowId(candidate) === picked) ?? null
  const notes = unreviewedNotes(data)
  const empty =
    data.captures === 0
      ? 'This case has no captures yet.'
      : data.total === 0
        ? 'Every capture in this case has a note or a selector match.'
        : null

  return (
    <div className="flex h-full flex-col" data-testid="unreviewed-view">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-canvas px-6 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <Inbox size={16} className="mt-0.5 shrink-0 text-text-muted" />
          <div className="min-w-0" data-testid="unreviewed-header">
            <div className="text-sm text-text-primary">
              {data.total === 1
                ? '1 unreviewed capture'
                : `${data.total.toLocaleString()} unreviewed captures`}
            </div>
            <div className="text-xs text-text-muted">
              {data.total === 1
                ? 'No note names it and no selector matched it.'
                : 'No note names them and no selector matched them.'}
            </div>
            {notes.map((note) => (
              <div key={note} className="text-xs text-text-muted" data-testid="unreviewed-note">
                {note}
              </div>
            ))}
          </div>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
          Rare identifiers: found in at most
          <Input
            type="number"
            min={1}
            step={1}
            value={limitText}
            onChange={(event) => changeLimit(event.target.value)}
            aria-label="Most captures a rare identifier is found in"
            className="h-7 w-16"
            data-testid="unreviewed-rare-limit"
          />
          captures
        </label>
      </div>

      {empty ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-text-muted">
          <span data-testid="unreviewed-empty">{empty}</span>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 divide-x divide-border">
          <Column title="Groups" className="w-56 shrink-0">
            {UNREVIEWED_GROUPS.map((key) => (
              <DirRow
                key={key}
                selected={group === key}
                onClick={() => {
                  setGroup(key)
                  setPicked(null)
                }}
              >
                <span
                  className="flex-1 truncate text-sm font-medium"
                  data-testid={`unreviewed-group-${key}`}
                >
                  {GROUP_LABELS[key]}
                </span>
                <Badge variant={group === key ? 'accent' : 'secondary'}>
                  {data.groups[key].length.toLocaleString()}
                </Badge>
              </DirRow>
            ))}
          </Column>

          <Column title={GROUP_LABELS[group]} className="w-80 shrink-0">
            {rows.length === 0 ? (
              <EmptyState>No captures in this group.</EmptyState>
            ) : (
              rows.map((candidate) => (
                <DirRow
                  key={rowId(candidate)}
                  selected={row === candidate}
                  onClick={() => setPicked(rowId(candidate))}
                >
                  <span className="min-w-0 flex-1">
                    {candidate.identifier && (
                      <span className="block text-[11px] uppercase tracking-wide text-text-faint">
                        {candidate.identifier.subcategory}
                      </span>
                    )}
                    <span
                      className="block break-all font-mono text-sm"
                      data-testid="unreviewed-row-key"
                    >
                      {candidate.key}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-text-muted">
                    {candidate.caseCaptures === null
                      ? captures(candidate.captures.length)
                      : `${candidate.captures.length.toLocaleString()} unreviewed, ${candidate.caseCaptures.toLocaleString()} in the case`}
                  </span>
                </DirRow>
              ))
            )}
          </Column>

          <Column title={row ? row.key : 'Captures'} className="min-w-0 flex-1">
            {!row ? (
              <EmptyState>Select a row</EmptyState>
            ) : (
              row.captures.map((capture) => (
                <button
                  key={capture.exhibitId}
                  type="button"
                  onClick={() => open(capture)}
                  className="flex w-full items-baseline gap-2 border-b border-border px-4 py-2.5 text-left text-text-primary last:border-b-0 hover:bg-elevated"
                  data-testid={`unreviewed-capture-${capture.exhibitId}`}
                >
                  <span className="shrink-0 font-mono text-xs text-text-muted">
                    Exhibit {capture.exhibitCitation}
                  </span>
                  <span className="min-w-0 truncate text-sm">{capture.title}</span>
                </button>
              ))
            )}
          </Column>
        </div>
      )}
    </div>
  )
}
