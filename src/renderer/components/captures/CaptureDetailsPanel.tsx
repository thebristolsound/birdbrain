import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { motion } from 'motion/react'
import {
  Star,
  ExternalLink,
  Download,
  Trash2,
  Globe,
  Calendar,
  Folder,
  FileType,
  Shield,
  Plus,
  StickyNote,
  ChevronRight
} from 'lucide-react'
import type { Capture } from '@shared/types'
import { caseQueryOptions, notesQueryOptions, useNotesMutations } from '@renderer/lib/queries'
import { useFavorites } from '@renderer/hooks/useFavorites'
import { useReduceMotion } from '@renderer/hooks/useReduceMotion'
import { useTimeTick } from '@renderer/hooks/useTimeTick'
import { presets } from '@renderer/lib/motion/presets'
import { formatRelativeTime } from '@renderer/lib/formatRelativeTime'
import { TagBadge } from '@renderer/components/tags/TagBadge'
import { TagEditorPopover } from './TagEditorPopover'
import { useCaptureTagEditor } from './useCaptureTagEditor'
import { useInlineNoteEditor } from './useInlineNoteEditor'
import { useVerifyMutation } from './useVerifyMutation'
import { getProvenanceColor } from './getProvenanceColor'

interface Props {
  capture: Capture
  caseId: string
  onCollapse: () => void
  onDownload: () => void
  onOpenExternal: () => void
  onDelete: () => void
  onOpenAddNote: () => void
}

export function CaptureDetailsPanel({
  capture,
  caseId,
  onCollapse,
  onDownload,
  onOpenExternal,
  onDelete,
  onOpenAddNote
}: Props) {
  const reduce = useReduceMotion()
  const tick = useTimeTick(60_000)
  const { data: caseData } = useQuery(caseQueryOptions(caseId))
  const { data: notes = [] } = useQuery(notesQueryOptions(caseId))
  const { create: createNote, update: updateNote } = useNotesMutations(caseId)
  const { favorites, toggleFavorite } = useFavorites(caseId)
  const { tags } = useCaptureTagEditor(capture.id)
  const verify = useVerifyMutation(capture.id, caseId)

  const [tagPopoverOpen, setTagPopoverOpen] = useState(false)
  const tagAnchorRef = useRef<HTMLButtonElement>(null)

  // Close tag popover on capture switch.
  useEffect(() => {
    setTagPopoverOpen(false)
  }, [capture.id])

  const captureNotes = notes.filter((n) => n.captureId === capture.id)
  const noteCount = captureNotes.length

  const inline = useInlineNoteEditor({
    notes: captureNotes,
    captureId: capture.id,
    captureTitle: capture.title || '',
    onCreate: async ({ title, body }) => {
      return createNote.mutateAsync({
        caseId,
        captureId: capture.id,
        title,
        body,
        sourceUrl: capture.url
      })
    },
    onUpdate: async ({ id, body }) => {
      return updateNote.mutateAsync({ id, body })
    }
  })

  const isFavorite = favorites.has(capture.id)
  const provenance = getProvenanceColor(capture.lastVerifiedStatus)

  let hostname = capture.url
  try {
    hostname = new URL(capture.url).hostname
  } catch {
    /* keep raw url */
  }

  const animationProps = reduce
    ? {}
    : {
        initial: presets.fadeUp.initial,
        animate: presets.fadeUp.animate,
        transition: presets.fadeUp.transition
      }

  // Saved-at re-renders with `tick` so "Saved 2m ago" stays fresh.
  void tick

  async function handleAddNote() {
    if (inline.isDirty) {
      await inline.flush()
    }
    onOpenAddNote()
  }

  return (
    <motion.div
      key={capture.id}
      {...animationProps}
      className="flex h-full flex-col overflow-y-auto"
    >
      {/* Header */}
      <section className="border-b border-border px-5 py-4 [&:last-child]:border-b-0">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight text-text-primary">
            Capture Details
          </h2>
          <div className="flex items-center gap-0.5">
            <button
              onClick={onCollapse}
              title="Collapse details"
              aria-label="Collapse details panel"
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => toggleFavorite(capture.id)}
              title={isFavorite ? 'Unfavorite' : 'Favorite'}
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary"
            >
              <Star
                className={`h-3.5 w-3.5 ${isFavorite ? 'fill-amber-400 text-amber-400' : ''}`}
              />
            </button>
            <button
              onClick={onOpenExternal}
              title="Open URL"
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onDownload}
              title="Download capture"
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onDelete}
              title="Delete capture"
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* Metadata grid */}
      <section className="space-y-3.5 border-b border-border px-5 py-4 [&:last-child]:border-b-0">
        <MetadataRow
          icon={<Globe className="h-3.5 w-3.5" />}
          label="Source"
          value={
            <button
              onClick={onOpenExternal}
              className="truncate text-left text-text-secondary hover:text-accent"
              title={capture.url}
            >
              {hostname}
            </button>
          }
        />
        <MetadataRow
          icon={<Calendar className="h-3.5 w-3.5" />}
          label="Captured"
          value={
            <span title={new Date(capture.timestamp).toLocaleString()}>
              {formatRelativeTime(capture.timestamp)}
            </span>
          }
        />
        <MetadataRow
          icon={<Folder className="h-3.5 w-3.5" />}
          label="Case"
          value={
            <Link
              to="/cases/$caseId"
              params={{ caseId }}
              className="text-text-secondary hover:text-accent"
            >
              {caseData?.name ?? '—'}
            </Link>
          }
        />
        <MetadataRow
          icon={<FileType className="h-3.5 w-3.5" />}
          label="Type"
          value={capture.format === 'mhtml' ? 'MHTML Archive' : 'HTML Page'}
        />
        <MetadataRow
          icon={<Shield className={`h-3.5 w-3.5 ${provenance.text}`} />}
          label="Provenance"
          value={
            <div className="flex items-center gap-2">
                <span
                  data-testid="capture-details-provenance-dot"
                  className={`inline-block h-1.5 w-1.5 rounded-full ${provenance.dot} ${
                    verify.isPending ? 'animate-pulse' : ''
                  }`}
                />
                <span
                  data-testid="capture-details-provenance-label"
                  className={provenance.text}
                >
                  {provenance.label}
                </span>
                <button
                  data-testid="capture-details-reverify-btn"
                  onClick={verify.verify}
                  disabled={verify.isPending}
                  className="ml-auto rounded-md px-2 py-0.5 text-[11px] text-accent hover:bg-accent-subtle disabled:opacity-50"
              >
                {verify.isPending ? 'Verifying…' : 'Re-verify'}
              </button>
            </div>
          }
        />
      </section>

      {/* Tags */}
      <section className="border-b border-border px-5 py-4 [&:last-child]:border-b-0">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">
            Tags
          </span>
          <div className="relative">
            <button
              ref={tagAnchorRef}
              onClick={() => setTagPopoverOpen((v) => !v)}
              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-accent hover:bg-accent-subtle"
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
            <TagEditorPopover
              captureId={capture.id}
              open={tagPopoverOpen}
              onClose={() => setTagPopoverOpen(false)}
              anchorRef={tagAnchorRef}
            />
          </div>
        </div>
        {tags.length === 0 ? (
          <p className="text-[11px] text-text-faint">No tags yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <TagBadge key={tag.id} tag={tag} />
            ))}
          </div>
        )}
      </section>

      {/* Notes */}
      <section className="border-b border-border px-5 py-4 [&:last-child]:border-b-0">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">
              Notes
            </span>
            {noteCount > 1 && (
              <span className="rounded-full bg-accent-subtle px-1.5 text-[10px] font-semibold text-accent">
                {noteCount} notes
              </span>
            )}
          </div>
          <button
            onClick={handleAddNote}
            title="New note"
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <textarea
          data-testid="inline-note-textarea"
          value={inline.value}
          onChange={(e) => inline.setValue(e.target.value)}
          onBlur={() => void inline.flush()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              inline.revert()
              ;(e.target as HTMLTextAreaElement).blur()
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void inline.flush()
              ;(e.target as HTMLTextAreaElement).blur()
            }
          }}
          placeholder="Add a quick note…"
          rows={4}
          className="w-full resize-none rounded-md border border-border bg-canvas p-2 text-xs text-text-primary placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {inline.savedAt && (
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-text-faint">
            <StickyNote className="h-3 w-3" />
            Saved {formatRelativeTime(inline.savedAt)}
          </p>
        )}
      </section>
    </motion.div>
  )
}

function MetadataRow({
  icon,
  label,
  value
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">
          {label}
        </div>
        <div className="text-xs text-text-secondary">{value}</div>
      </div>
    </div>
  )
}
