import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import type { Persona, PersonaImportResult } from '@shared/types'
import {
  personasQueryOptions,
  personaStorageStateQueryOptions,
  usePersonasMutations
} from '@renderer/lib/api/personas'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label
} from '@renderer/components/ui'

// Settings → Personas (#1497, ADR-0030). A persona is a signed-in browser
// identity, yours or a pseudonym; the copy says so in those words (decision
// 2). Nothing exists until the operator adds one (decision 10), so the empty
// state is one button and a sentence.
export function PersonasSection() {
  const { data: personas } = useQuery(personasQueryOptions)
  const { data: storage } = useQuery(personaStorageStateQueryOptions)
  const { create, importCookies } = usePersonasMutations()
  const [adding, setAdding] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Persona | null>(null)
  // The #414 acknowledgement, held for the session: once the operator has
  // accepted that the cookie store is unprotected on this machine, every
  // import that follows is under the same fact.
  const [unprotectedAcknowledged, setUnprotectedAcknowledged] = useState(false)
  const [lastImport, setLastImport] = useState<{
    personaId: string
    result: PersonaImportResult
  } | null>(null)
  const [importError, setImportError] = useState<{ personaId: string; message: string } | null>(
    null
  )

  // Unknown (still loading, or the read failed) blocks import like an
  // unprotected store does, so no cookie is written before the answer.
  const storageKnown = storage !== undefined
  const encryptionAvailable = storage?.encryptionAvailable ?? false
  const importBlocked = !storageKnown || (!encryptionAvailable && !unprotectedAcknowledged)

  async function submitCreate(e: FormEvent) {
    e.preventDefault()
    const label = newLabel.trim()
    if (!label) return
    await create.mutateAsync({ label })
    setNewLabel('')
    setAdding(false)
  }

  // A refused file carries a message naming the supported exports, shown on
  // the row; every other failure is left to the mutation toast.
  async function runImport(personaId: string) {
    setImportError(null)
    try {
      const result = await importCookies.mutateAsync(personaId)
      if (result) setLastImport({ personaId, result })
    } catch (err) {
      if (isUnsupportedFileError(err)) setImportError({ personaId, message: err.message })
    }
  }

  if (!personas) return <div className="text-text-muted">Loading...</div>

  return (
    <div className="space-y-4" data-testid="personas-section">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Personas</h2>
        <p className="mt-1 text-[11px] text-text-muted">
          Cookie files are read, loaded into the persona&rsquo;s browser session, and discarded;
          passwords are never stored.
        </p>
      </div>

      {storageKnown && !encryptionAvailable && (
        <div
          role="alert"
          data-testid="persona-unprotected-warning"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-text-secondary"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
            <div className="space-y-2">
              <p>
                The operating system credential store is unavailable on this machine, so imported
                cookies sit on disk unprotected, readable by anything that can read this
                user&rsquo;s files.
              </p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  data-testid="persona-unprotected-acknowledge"
                  checked={unprotectedAcknowledged}
                  onChange={(e) => setUnprotectedAcknowledged(e.target.checked)}
                />
                I understand; allow cookie import anyway.
              </label>
            </div>
          </div>
        </div>
      )}

      {personas.length === 0 && !adding ? (
        <div
          data-testid="personas-empty"
          className="rounded-md border border-dashed border-border p-6 text-center"
        >
          <p className="text-xs text-text-muted">No personas yet.</p>
          <Button className="mt-3" data-testid="persona-add" onClick={() => setAdding(true)}>
            Add persona
          </Button>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="personas-list">
          {personas.map((persona) => (
            <PersonaRow
              key={persona.id}
              persona={persona}
              importBlocked={importBlocked}
              storageKnown={storageKnown}
              importing={importCookies.isPending && importCookies.variables === persona.id}
              lastImport={lastImport?.personaId === persona.id ? lastImport.result : null}
              importError={importError?.personaId === persona.id ? importError.message : null}
              onImport={() => void runImport(persona.id)}
              onDelete={() => setPendingDelete(persona)}
            />
          ))}
        </ul>
      )}

      {adding ? (
        <form onSubmit={(e) => void submitCreate(e)} className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-xs font-medium text-text-secondary">Label</Label>
            <Input
              autoFocus
              value={newLabel}
              data-testid="persona-new-label"
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. Research account"
              className="border-border bg-surface"
            />
          </div>
          <Button
            type="submit"
            data-testid="persona-create"
            disabled={!newLabel.trim() || create.isPending}
          >
            {create.isPending ? 'Creating…' : 'Create'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setAdding(false)
              setNewLabel('')
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        personas.length > 0 && (
          <Button variant="outline" data-testid="persona-add" onClick={() => setAdding(true)}>
            Add persona
          </Button>
        )
      )}

      {pendingDelete && (
        <DeletePersonaDialog
          open
          persona={pendingDelete}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null)
          }}
        />
      )}
    </div>
  )
}

interface PersonaRowProps {
  persona: Persona
  importBlocked: boolean
  storageKnown: boolean
  importing: boolean
  lastImport: PersonaImportResult | null
  importError: string | null
  onImport: () => void
  onDelete: () => void
}

function PersonaRow({
  persona,
  importBlocked,
  storageKnown,
  importing,
  lastImport,
  importError,
  onImport,
  onDelete
}: PersonaRowProps) {
  const { update } = usePersonasMutations()
  const [label, setLabel] = useState(persona.label)

  async function commitRename() {
    const next = label.trim()
    if (!next) {
      setLabel(persona.label)
      return
    }
    setLabel(next)
    if (next === persona.label) return
    await update.mutateAsync({ id: persona.id, label: next })
  }

  return (
    <li
      data-testid={`persona-row-${persona.id}`}
      className="rounded-md border border-border bg-surface p-3"
    >
      <div className="flex items-center gap-2">
        <Input
          value={label}
          aria-label="Persona label"
          data-testid="persona-label"
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => void commitRename()}
          className="flex-1 border-border bg-surface"
        />
        <Button
          variant="outline"
          data-testid="persona-import"
          disabled={importBlocked || importing}
          title={
            !storageKnown
              ? 'Checking whether the cookie store is protected'
              : importBlocked
                ? 'Acknowledge the unprotected cookie store above to import'
                : 'Load a cookie file into this persona'
          }
          onClick={onImport}
        >
          {importing ? 'Importing…' : 'Import cookies'}
        </Button>
        <Button variant="ghost" data-testid="persona-delete" onClick={onDelete}>
          Delete
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-text-muted" data-testid="persona-import-summary">
        {describeImport(persona, lastImport)}
      </p>
      {importError && (
        <p
          role="alert"
          className="mt-1 text-[11px] text-red-400"
          data-testid="persona-import-error"
        >
          {importError}
        </p>
      )}
    </li>
  )
}

function isUnsupportedFileError(err: unknown): err is Error {
  return (
    err instanceof Error && (err as { code?: string }).code === 'PERSONA_COOKIE_FILE_UNSUPPORTED'
  )
}

// One sentence per state, so a row always says whether the session holds
// anything and, after an import, exactly how many rows did not load.
function describeImport(persona: Persona, lastImport: PersonaImportResult | null): string {
  if (lastImport) {
    const { accepted, rejected } = lastImport
    const skipped = rejected.length
      ? `, ${rejected.length} skipped (${summariseRejections(lastImport)})`
      : ''
    return `Imported ${accepted} cookie${accepted === 1 ? '' : 's'} just now${skipped}.`
  }
  if (persona.lastImportAt === null || persona.lastImportCount === null) {
    return 'No cookies imported yet.'
  }
  const when = new Date(persona.lastImportAt).toLocaleString()
  return `Last import: ${persona.lastImportCount} cookie${
    persona.lastImportCount === 1 ? '' : 's'
  } on ${when}.`
}

function summariseRejections(result: PersonaImportResult): string {
  const counts = new Map<string, number>()
  for (const r of result.rejected) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1)
  const labels: Record<string, string> = {
    malformed: 'malformed',
    expired: 'expired',
    'unknown-same-site': 'unknown SameSite',
    'rejected-by-session': 'refused by the browser'
  }
  return [...counts.entries()].map(([reason, n]) => `${n} ${labels[reason] ?? reason}`).join(', ')
}

interface DeletePersonaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  persona: Persona
}

// Confirmed because the delete is the security action (ADR-0030, decision
// 4): it empties the persona's browser session. The row is kept so historic
// captures keep their label; the copy says both.
export function DeletePersonaDialog({ open, onOpenChange, persona }: DeletePersonaDialogProps) {
  const { remove } = usePersonasMutations()

  async function handleDelete() {
    try {
      await remove.mutateAsync(persona.id)
    } catch {
      return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} data-testid="delete-persona-dialog">
        <DialogHeader>
          <DialogTitle>Delete &lsquo;{persona.label}&rsquo;?</DialogTitle>
          <DialogDescription>
            Every cookie and any other browser data held for &lsquo;{persona.label}&rsquo; is
            cleared from this machine, and the persona leaves every picker. Captures already made
            with it keep its name. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            data-testid="delete-persona-cancel"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            data-testid="delete-persona-confirm"
            disabled={remove.isPending}
            onClick={() => void handleDelete()}
          >
            {remove.isPending ? 'Deleting…' : `Delete '${persona.label}'`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
