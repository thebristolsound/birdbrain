import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import {
  Star,
  Copy,
  CopyPlus,
  Hash,
  ExternalLink,
  Trash2,
  Globe,
  Calendar,
  Shield,
  ShieldCheck,
  RefreshCcw,
  MoreHorizontal,
  Plus,
  StickyNote,
  ChevronRight,
  ChevronDown
} from 'lucide-react'
import type { Capture } from '@shared/types'
import {
  notesQueryOptions,
  useNotesMutations,
  useRecaptureMutations,
  useVerifyCapture
} from '@renderer/lib/queries'
import { useAppStore } from '@renderer/stores/appStore'
import { useFavorites } from '@renderer/hooks/useFavorites'
import { useReduceMotion } from '@renderer/hooks/useReduceMotion'
import { useTimeTick } from '@renderer/hooks/useTimeTick'
import { presets } from '@renderer/lib/motion/presets'
import { formatRelativeTime } from '@renderer/lib/formatRelativeTime'
import { TagBadge } from '@renderer/components/tags/TagBadge'
import { TagEditorPopover } from '@renderer/components/captures/TagEditorPopover'
import { useCaptureTagEditor } from '@renderer/components/captures/useCaptureTagEditor'
import { useInlineNoteEditor } from '@renderer/components/captures/useInlineNoteEditor'
import { NoteEditor } from '@renderer/components/notes/NoteEditor'
import { useNoteEditor } from '@renderer/components/notes/useNoteEditor'
import { getProvenanceColor } from '@renderer/components/captures/getProvenanceColor'
import { ForensicsTab } from '@renderer/components/captures/ForensicsTab'
import { CAPTURE_METHOD_LABELS } from '@renderer/components/captures/captureMethodLabel'

interface Props {
  capture: Capture
  caseId: string
  onCollapse: () => void
  onOpenExternal: () => void
  onCopyUrl: () => void
  onCopyHash: () => void
  onDuplicate: () => void
  isDuplicating: boolean
  onDelete: () => void
  onOpenAddNote: () => void
}

export function CaptureDetailsPanel({
  capture,
  caseId,
  onCollapse,
  onOpenExternal,
  onCopyUrl,
  onCopyHash,
  onDuplicate,
  isDuplicating,
  onDelete,
  onOpenAddNote
}: Props) {
  const reduce = useReduceMotion()
  const tick = useTimeTick(60_000)
  const { data: notes = [] } = useQuery(notesQueryOptions(caseId))
  const { create: createNote, update: updateNote } = useNotesMutations(caseId)
  const { favorites, toggleFavorite } = useFavorites(caseId)
  const { tags } = useCaptureTagEditor(capture.id)
  const verify = useVerifyCapture(capture.id, caseId)
  const { enqueue } = useRecaptureMutations(caseId)

  const [tagPopoverOpen, setTagPopoverOpen] = useState(false)
  const tagAnchorRef = useRef<HTMLButtonElement>(null)

  const [menuOpen, setMenuOpen] = useState(false)
  const [recaptureError, setRecaptureError] = useState<{ captureId: string; message: string } | null>(
    null
  )
  const menuRef = useRef<HTMLDivElement>(null)
  const menuAnchorRef = useRef<HTMLButtonElement>(null)

  const [custodyOpen, setCustodyOpen] = useState(true)

  // A background recapture emits a 'received' event at the start of its job and a
  // terminal 'stored'/'failed' event when it finishes; the store keeps the
  // 'received' entry alive for the whole run. The enqueue mutation's isPending
  // only covers the millisecond IPC hand-off, so drive the in-progress UI off the
  // live event instead. Scope by supersedesCaptureId (the exact capture being
  // recaptured), not URL — recapture creates same-URL siblings. Select the
  // derived boolean so Zustand's Object.is check skips unrelated event updates.
  const isRecapturing = useAppStore((s) =>
    s.captureEvents.some(
      (e) =>
        e.type === 'received' && e.source === 'recapture' && e.supersedesCaptureId === capture.id
    )
  )

  // Close tag popover on capture switch.
  useEffect(() => {
    setTagPopoverOpen(false)
  }, [capture.id])

  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (menuRef.current?.contains(target)) return
      if (menuAnchorRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const captureNotes = notes.filter((n) => n.captureId === capture.id)
  const noteCount = captureNotes.length

  const inline = useInlineNoteEditor({
    notes: captureNotes,
    captureId: capture.id,
    captureTitle: capture.title || '',
    onCreate: async ({ title, bodyDoc }) => {
      return createNote.mutateAsync({
        caseId,
        captureId: capture.id,
        title,
        bodyDoc,
        sourceUrl: capture.url
      })
    },
    onUpdate: async ({ id, bodyDoc }) => {
      return updateNote.mutateAsync({ id, bodyDoc })
    }
  })

  const noteEditor = useNoteEditor({
    caseId,
    noteId: inline.boundNoteId ?? undefined,
    onChange: inline.setValue,
    testId: 'inline-note-editor'
  })

  // Push the hook's document into the editor when it changes from outside —
  // a different capture selected, or Esc reverting. The equality guard keeps
  // the user's own keystrokes from bouncing back and resetting the cursor.
  useEffect(() => {
    if (!noteEditor) return
    if (JSON.stringify(noteEditor.getJSON()) === inline.value) return
    try {
      noteEditor.commands.setContent(JSON.parse(inline.value), { emitUpdate: false })
    } catch {
      noteEditor.commands.clearContent()
    }
  }, [noteEditor, inline.value])

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

  function handleRecapture() {
    setMenuOpen(false)
    setRecaptureError(null)
    enqueue.mutate(
      { urls: [capture.url], supersedesCaptureId: capture.id },
      {
        onSuccess: (result) => {
          const reason = result.rejected[0]?.reason
          if (reason) {
            setRecaptureError({ captureId: capture.id, message: reason })
          }
        },
        onError: (err) =>
          setRecaptureError({
            captureId: capture.id,
            message: err instanceof Error ? err.message : 'Recapture failed'
          })
      }
    )
  }

  const menuItemClass =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary hover:bg-elevated disabled:opacity-50'

  return (
    <motion.div
      key={capture.id}
      {...animationProps}
      className="flex h-full flex-col overflow-y-auto"
    >
      {/* Header: title + provenance chip + actions menu */}
      <section className="border-b border-border px-5 py-4 [&:last-child]:border-b-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight text-text-primary">Capture</h2>
          <span
            data-testid="capture-details-provenance-chip"
            className={`flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 ${provenance.bg}`}
          >
            <ShieldCheck className={`h-3 w-3 ${provenance.text}`} />
            <span
              data-testid="capture-details-provenance-label"
              className={`text-[11px] font-semibold ${provenance.text}`}
            >
              {provenance.label}
            </span>
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            <div className="relative">
              <button
                ref={menuAnchorRef}
                onClick={() => setMenuOpen((v) => !v)}
                title="Capture actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                data-testid="capture-details-actions-btn"
                className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
              {menuOpen && (
                <div
                  ref={menuRef}
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border-strong bg-card py-1 shadow-xl"
                >
                  <button
                    role="menuitem"
                    data-testid="capture-details-star-btn"
                    onClick={() => {
                      toggleFavorite(capture.id)
                      setMenuOpen(false)
                    }}
                    className={menuItemClass}
                  >
                    <Star
                      className={`h-3.5 w-3.5 shrink-0 ${
                        isFavorite ? 'fill-amber-400 text-amber-400' : 'text-text-muted'
                      }`}
                    />
                    {isFavorite ? 'Unstar' : 'Star'}
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      onOpenExternal()
                    }}
                    className={menuItemClass}
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                    Open URL
                  </button>
                  <button
                    role="menuitem"
                    data-testid="capture-details-copy-url-btn"
                    onClick={() => {
                      setMenuOpen(false)
                      onCopyUrl()
                    }}
                    className={menuItemClass}
                  >
                    <Copy className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                    Copy URL
                    {/* Ctrl, not ⌘, on every platform: the handler accepts both
                        modifiers, and this is the spelling the app already uses
                        for Ctrl+K in the top bar. */}
                    <span className="ml-auto text-[10px] text-text-faint">Ctrl+C</span>
                  </button>
                  <button
                    role="menuitem"
                    data-testid="capture-details-copy-hash-btn"
                    onClick={() => {
                      setMenuOpen(false)
                      onCopyHash()
                    }}
                    className={menuItemClass}
                  >
                    <Hash className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                    Copy SHA-256
                  </button>
                  <button
                    role="menuitem"
                    data-testid="capture-details-recapture-btn"
                    disabled={enqueue.isPending || isRecapturing}
                    onClick={handleRecapture}
                    className={menuItemClass}
                  >
                    <RefreshCcw
                      className={`h-3.5 w-3.5 shrink-0 text-text-muted ${
                        isRecapturing ? 'animate-spin' : ''
                      }`}
                    />
                    {isRecapturing ? 'Recapturing…' : 'Recapture current page'}
                  </button>
                  <button
                    role="menuitem"
                    data-testid="capture-details-duplicate-btn"
                    disabled={isDuplicating}
                    onClick={() => {
                      setMenuOpen(false)
                      onDuplicate()
                    }}
                    className={menuItemClass}
                  >
                    <CopyPlus className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                    {isDuplicating ? 'Duplicating…' : 'Duplicate'}
                  </button>
                  <div className="my-1 border-t border-border" />
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      onDelete()
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-400 hover:bg-elevated"
                  >
                    <Trash2 className="h-3.5 w-3.5 shrink-0" />
                    Delete capture
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={onCollapse}
              title="Collapse details"
              aria-label="Collapse details panel"
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {recaptureError && recaptureError.captureId === capture.id && !isRecapturing && (
          <p
            data-testid="capture-details-recapture-error"
            title={recaptureError.message}
            className="mt-2 text-[11px] text-red-500"
          >
            Recapture failed: {recaptureError.message}
          </p>
        )}
      </section>

      {/* Metadata */}
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
              {[
                formatRelativeTime(capture.timestamp),
                capture.format === 'mhtml' ? 'MHTML Archive' : 'HTML Page',
                CAPTURE_METHOD_LABELS[capture.method] ?? ''
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          }
        />
      </section>

      {/* Chain of custody (absorbs the old Forensics tab) */}
      <section className="border-b border-border [&:last-child]:border-b-0">
        <div className="flex items-center gap-2 px-5 py-3.5">
          <button
            onClick={() => setCustodyOpen((v) => !v)}
            aria-expanded={custodyOpen}
            data-testid="custody-section-toggle"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <Shield className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
              Chain of custody
            </span>
          </button>
          <button
            type="button"
            onClick={verify.verify}
            disabled={verify.isPending}
            className="rounded-md px-2 py-0.5 text-[11px] text-accent hover:bg-accent-subtle disabled:opacity-50"
            data-testid="forensics-reverify-btn"
          >
            {verify.isPending ? 'Verifying…' : 'Re-verify'}
          </button>
          <button
            onClick={() => setCustodyOpen((v) => !v)}
            aria-label={custodyOpen ? 'Collapse chain of custody' : 'Expand chain of custody'}
            className="text-text-muted hover:text-text-secondary"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${custodyOpen ? '' : '-rotate-90'}`}
            />
          </button>
        </div>
        {custodyOpen && (
          <div data-testid="custody-section-body" className="border-t border-border">
            <ForensicsTab capture={capture} caseId={caseId} />
          </div>
        )}
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
        <NoteEditor
          editor={noteEditor}
          placeholder="Add a quick note…"
          minHeightClass="min-h-20"
          selectionActions={{
            caseId,
            // The inline editor autosaves, so the note may not exist yet when
            // the Tag action fires; flushing first is what gives it one (#391).
            resolveNoteId: async () => {
              const id = await inline.flush()
              if (!id) throw new Error('Write the note before tagging it')
              return id
            }
          }}
          onBlur={() => void inline.flush()}
          onKeyDown={(e) => {
            // An Escape the editor already handled — dismissing the Mention
            // autocomplete — must not also throw the draft away.
            if (e.defaultPrevented) return
            if (e.key === 'Escape') {
              e.preventDefault()
              inline.revert()
              noteEditor?.commands.blur()
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void inline.flush()
              noteEditor?.commands.blur()
            }
          }}
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
