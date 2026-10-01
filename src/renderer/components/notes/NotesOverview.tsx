import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { useReduceMotion } from '@renderer/hooks/useReduceMotion'
import { useTimeTick } from '@renderer/hooks/useTimeTick'
import { DropdownMenu } from 'radix-ui'
import { Search, Plus, StickyNote, ArrowUpDown, Filter, List, Rows3, Check } from 'lucide-react'
import {
  notesQueryOptions,
  notesSearchQueryOptions,
  useNotesMutations
} from '@renderer/lib/queries'
import { EntityContextMenu } from '@renderer/components/contextmenu/EntityContextMenu'
import { openCaptureExternal } from '@renderer/lib/api/system'
import { notify } from '@renderer/lib/notify'
import { Button } from '@renderer/components/ui'
import { NOTE_COMPOSER_EVENT } from '@renderer/components/onboarding/tourEffects'
import { useAppStore } from '@renderer/stores/appStore'
import { EMPTY_NOTE_DOC } from '@shared/noteDoc'
import { NoteWorkspaceDetail } from '@renderer/components/notes/NoteWorkspaceDetail'
import { NoteListRow } from '@renderer/components/notes/NoteListRow'
import { useMentionResolver } from '@renderer/components/notes/mention/useMentionSources'
import {
  filterNotes,
  usedNoteTags,
  type NoteSort,
  type NoteDateFilter
} from '@renderer/components/notes/notesWorkspaceModel'

const menuClass =
  'z-50 min-w-44 rounded-md border border-border bg-surface p-1 text-xs text-text-secondary shadow-xl'
const itemClass =
  'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none focus:bg-elevated'

export function NotesOverview() {
  const { caseId } = useParams({ from: '/cases/$caseId/notes' })
  return <NotesWorkspace key={caseId} caseId={caseId} />
}

// Owns the keystroke state so typing re-renders only this input; the list
// re-renders once per debounced query.
function NotesSearchInput({ onSearch }: { onSearch: (query: string) => void }) {
  const [value, setValue] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => onSearch(value.trim()), 200)
    return () => clearTimeout(timer)
  }, [value, onSearch])
  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
      <input
        data-testid="notes-search"
        aria-label="Search notes"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search notes…"
        className="w-full rounded border border-border bg-canvas py-1.5 pl-7 pr-2 text-xs text-text-primary outline-none focus:border-accent"
      />
    </div>
  )
}

function NotesWorkspace({ caseId }: { caseId: string }) {
  const reduceMotion = useReduceMotion()
  const requestedId = useAppStore((s) => s.selectedNoteId)
  const [selectedId, setSelectedId] = useState<string | null>(requestedId)
  const [createdNote, setCreatedNote] = useState<import('@shared/types').Note | null>(null)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [searchKey, setSearchKey] = useState(0)
  const [sort, setSort] = useState<NoteSort>('newest')
  const [tag, setTag] = useState('')
  const [date, setDate] = useState<NoteDateFilter>('all')
  const [deleteRequest, setDeleteRequest] = useState<string | null>(null)
  const [view, setView] = useState<'detailed' | 'list'>('detailed')
  const flushRef = useRef<(() => Promise<boolean>) | null>(null)
  const creating = useRef(false)
  const { create, remove } = useNotesMutations(caseId)
  const resolve = useMentionResolver(caseId)
  const {
    data: allNotes = [],
    isLoading,
    isError,
    error,
    refetch
  } = useQuery(notesQueryOptions(caseId))
  const search = useQuery(notesSearchQueryOptions(caseId, debouncedQuery))
  const all =
    createdNote && !allNotes.some((n) => n.id === createdNote.id)
      ? [createdNote, ...allNotes]
      : allNotes
  const selected = all.find((n) => n.id === selectedId) ?? all[0]
  // The date filters are relative, so the memo also expires as the cutoff moves.
  const nowTick = useTimeTick(60_000)
  const nowMs = useMemo(() => Date.now(), [nowTick])
  const notes = useMemo(
    () => filterNotes(debouncedQuery ? (search.data ?? []) : all, sort, tag, date, nowMs),
    [debouncedQuery, search.data, all, sort, tag, date, nowMs]
  )
  const activeCount = Number(!!tag) + Number(date !== 'all')
  const narrowed = !!debouncedQuery || activeCount > 0
  const tags = useMemo(() => usedNoteTags(all), [all])

  useEffect(() => {
    if (createdNote && allNotes.some((note) => note.id === createdNote.id)) setCreatedNote(null)
  }, [allNotes, createdNote])

  async function selectNote(id: string) {
    if (flushRef.current && !(await flushRef.current())) return false
    setSelectedId(id)
    useAppStore.getState().setSelectedNoteId(id)
    return true
  }
  useEffect(() => {
    if (!requestedId || requestedId === selectedId) return
    let active = true
    void (async () => {
      if (flushRef.current && !(await flushRef.current())) return
      if (active) setSelectedId(requestedId)
    })()
    return () => {
      active = false
    }
  }, [requestedId, selectedId])

  const newNoteRef = useRef<() => Promise<void>>(async () => {})
  async function newNote() {
    if (creating.current) return
    creating.current = true
    try {
      if (flushRef.current && !(await flushRef.current())) return
      const note = await create.mutateAsync({
        caseId,
        title: '',
        bodyDoc: JSON.stringify(EMPTY_NOTE_DOC)
      })
      setCreatedNote(note)
      setSelectedId(note.id)
      useAppStore.getState().setSelectedNoteId(note.id)
      clearFilters()
    } catch {
      // Mutation metadata supplies the user-visible error toast.
    } finally {
      creating.current = false
    }
  }
  useEffect(() => {
    newNoteRef.current = newNote
  })
  useEffect(() => {
    const open = () => {
      void newNoteRef.current()
    }
    window.addEventListener(NOTE_COMPOSER_EVENT, open)
    return () => window.removeEventListener(NOTE_COMPOSER_EVENT, open)
  }, [])
  function clearFilters() {
    setSearchKey((k) => k + 1)
    setDebouncedQuery('')
    setTag('')
    setDate('all')
  }
  async function deleteNote(id: string) {
    try {
      await remove.mutateAsync(id)
    } catch {
      return
    }
    if (createdNote?.id === id) setCreatedNote(null)
    setSelectedId(null)
    useAppStore.getState().setSelectedNoteId(null)
  }

  if (isLoading) return <div className="p-6 text-text-muted">Loading notes…</div>
  if (isError)
    return (
      <div className="space-y-2 p-6">
        <p className="text-sm text-red-400">
          Failed to load notes: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    )

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden" data-testid="notes-workspace">
      <aside
        aria-label="Notes list"
        className="flex w-[320px] shrink-0 flex-col border-r border-border bg-surface"
      >
        <div className="flex items-center gap-2 border-b border-border p-2">
          <NotesSearchInput key={searchKey} onSearch={setDebouncedQuery} />
          <button
            data-testid="notes-new-button"
            title="New note"
            aria-label="New note"
            disabled={create.isPending}
            onClick={() => void newNote()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-1 border-b border-border px-1.5 py-1">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              aria-label="Sort notes"
              className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] hover:bg-elevated ${sort !== 'newest' ? 'text-accent' : 'text-text-muted'}`}
            >
              <ArrowUpDown className="h-3 w-3" />
              Sort
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className={menuClass} align="start">
                {(
                  [
                    ['newest', 'Newest first'],
                    ['oldest', 'Oldest first'],
                    ['title', 'Title A–Z']
                  ] as const
                ).map(([value, label]) => (
                  <DropdownMenu.CheckboxItem
                    key={value}
                    checked={sort === value}
                    onSelect={() => setSort(value)}
                    className={itemClass}
                  >
                    <span className="w-3">
                      {sort === value ? <Check className="h-3 w-3" /> : null}
                    </span>
                    {label}
                  </DropdownMenu.CheckboxItem>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              aria-label="Filter notes"
              className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] hover:bg-elevated ${activeCount ? 'text-accent' : 'text-text-muted'}`}
            >
              <Filter className="h-3 w-3" />
              Filter
              {activeCount ? (
                <span className="rounded-full bg-accent/10 px-1.5 text-accent">{activeCount}</span>
              ) : null}
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className={menuClass} align="start">
                <DropdownMenu.Label className="px-2 py-1 text-[10px] uppercase text-text-faint">
                  Tag
                </DropdownMenu.Label>
                {[{ targetId: '', label: 'All tags' }, ...tags].map((t) => (
                  <DropdownMenu.CheckboxItem
                    key={t.targetId}
                    checked={tag === t.targetId}
                    onSelect={() => setTag(t.targetId)}
                    className={itemClass}
                  >
                    <span className="w-3">
                      {tag === t.targetId ? <Check className="h-3 w-3" /> : null}
                    </span>
                    {t.targetId ? `#${resolve('tag', t.targetId).label || t.label}` : t.label}
                  </DropdownMenu.CheckboxItem>
                ))}
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
                <DropdownMenu.Label className="px-2 py-1 text-[10px] uppercase text-text-faint">
                  Date
                </DropdownMenu.Label>
                {(
                  [
                    ['all', 'Any time'],
                    ['today', 'Last 24 hours'],
                    ['7days', 'Last 7 days']
                  ] as const
                ).map(([value, label]) => (
                  <DropdownMenu.CheckboxItem
                    key={value}
                    checked={date === value}
                    onSelect={() => setDate(value)}
                    className={itemClass}
                  >
                    <span className="w-3">
                      {date === value ? <Check className="h-3 w-3" /> : null}
                    </span>
                    {label}
                  </DropdownMenu.CheckboxItem>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <div
            role="group"
            aria-label="Note view"
            className="ml-auto flex rounded border border-border bg-canvas p-0.5"
          >
            <button
              aria-label="Detailed view"
              title="Detailed view"
              aria-pressed={view === 'detailed'}
              onClick={() => setView('detailed')}
              className={`rounded p-1 ${view === 'detailed' ? 'bg-surface text-text-primary' : 'text-text-faint'}`}
            >
              <Rows3 className="h-3 w-3" />
            </button>
            <button
              aria-label="List view"
              title="List view"
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
              className={`rounded p-1 ${view === 'list' ? 'bg-surface text-text-primary' : 'text-text-faint'}`}
            >
              <List className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div
          data-testid="notes-list"
          className="flex min-h-0 flex-1 flex-col gap-[var(--d-listgap)] overflow-y-auto px-2 py-[var(--d-listgap)]"
        >
          {debouncedQuery && search.isError ? (
            <div className="p-4 text-xs text-red-400">
              Failed to search notes.
              <button className="ml-2 underline" onClick={() => void search.refetch()}>
                Retry search
              </button>
            </div>
          ) : debouncedQuery && search.isFetching ? (
            <p className="p-4 text-xs text-text-muted">Searching notes…</p>
          ) : !notes.length ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8 text-center">
              <motion.div
                animate={reduceMotion ? undefined : { y: [0, -4, 0] }}
                transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-canvas"
              >
                <StickyNote className="h-4 w-4 text-text-faint" />
              </motion.div>
              <h2 className="text-xs font-semibold text-text-secondary">
                {narrowed ? 'No notes match' : 'No notes yet'}
              </h2>
              {narrowed && (
                <p className="max-w-[200px] text-[11px] leading-relaxed text-text-faint">
                  Try a broader search, or clear the filters on this list.
                </p>
              )}
              {narrowed ? (
                <button
                  onClick={clearFilters}
                  className="rounded border border-border px-2.5 py-1 text-[11px] text-text-secondary hover:bg-elevated"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : (
            notes.map((note) => (
              <EntityContextMenu
                key={note.id}
                target={{
                  kind: 'note',
                  noteId: note.id,
                  title: note.title || 'Untitled note',
                  sourceUrl: note.sourceUrl ?? null,
                  actions: {
                    edit: () => {
                      void selectNote(note.id)
                    },
                    openSourceUrl: () => {
                      if (note.sourceUrl)
                        void openCaptureExternal(note.sourceUrl).catch((cause) =>
                          notify.error("Couldn't open the link in your browser", { cause })
                        )
                    },
                    remove: () => {
                      void selectNote(note.id).then((selected) => {
                        if (selected) setDeleteRequest(note.id)
                      })
                    }
                  }
                }}
              >
                <NoteListRow
                  note={note}
                  selected={selected?.id === note.id}
                  view={view}
                  resolve={resolve}
                  onSelect={() => void selectNote(note.id)}
                />
              </EntityContextMenu>
            ))
          )}
        </div>
        <footer className="border-t border-border px-3 py-2.5 text-[11px] text-text-faint">
          {narrowed
            ? `${notes.length} of ${all.length} notes shown`
            : `${all.length} ${all.length === 1 ? 'note' : 'notes'} in this case`}
        </footer>
      </aside>
      {selected ? (
        <NoteWorkspaceDetail
          key={selected.id}
          note={selected}
          notes={all}
          flushRef={flushRef}
          onDelete={deleteNote}
          requestDelete={deleteRequest === selected.id}
          clearDeleteRequest={() => setDeleteRequest(null)}
        />
      ) : (
        <main className="flex flex-1 items-center justify-center bg-canvas text-xs text-text-faint">
          Create a note to start writing.
        </main>
      )}
    </div>
  )
}
