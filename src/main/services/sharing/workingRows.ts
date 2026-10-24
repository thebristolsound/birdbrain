import { createHash } from 'crypto'
import type { CaseMember, SyncErrorKind } from '@shared/types'
import { canonicalStringify, verifyEntrySignature } from '@shared/verify'
import { withTransaction } from '@main/services/db/core'
import { getInstallationId } from '@main/services/installationId'
import { getPublicKeyPem, signEntryHash } from '@main/services/signingKey'
import {
  CURSOR_FREE_TABLES,
  applyRows,
  caseOfRow,
  clearUnsharedNoteLinks,
  hardDeleteLocalRow,
  isInSharedCase,
  isSharedCaseId,
  isSyncedTable,
  maxLocalVersion,
  noteReferencedCases,
  ownLiveRowsOnCapture,
  ownUnsignedRowsInCase,
  readRow,
  recordAuthorRowCursor,
  recordDeletedCapture,
  referenceError,
  referenceOf,
  removeCaptureDependents,
  removeExhibitDependents,
  removeOwnRowsOnCapture,
  rowIdCollision,
  signedColumns,
  writeRowSync,
  type RemoteRow,
  type RowFields,
  type RowKey,
  type StoredRow,
  type SyncedTable,
  type TableOffer
} from '@main/services/db/workingRowRepo'
import type { WireRow } from '@main/services/sharing/messages'
import { localVersionHighWater, recordLocalVersion } from '@main/services/sharing/syncState'

// Working-layer rows as evidence of who wrote what (docs/specs/2026-09-19-
// collaborative-cases-design.md, "Working-layer rows"). This installation
// signs each of its rows on every write: the signature is RSA-SHA256 by the
// installation key over the SHA-256 of the canonical JSON of the row's
// envelope (table, author, version, the Case the row belongs to, tombstone,
// content columns), the same key and primitive a manifest entry uses. A
// remote row is applied only when that envelope verifies under the key the
// roster holds for its author, only when the Case it names is the one being
// synced and the row it references is of that Case, and only above the
// version already stored for it. The Case is in the envelope because a
// roster member of one Case must not be able to write into another Case the
// receiver holds: the row's own columns name the Case directly or through
// an Exhibit or Capture, and the author signs which one it meant.
//
// Versions are one sequence per installation across every table and Case:
// each write takes the next one, so a peer's "rows above version n" request
// names exactly what it has not seen. A row this installation deletes in a
// Shared Case keeps its row, tombstoned and re-signed, so the deletion syncs
// (ruling 3 of 2026-10-13); in a Case nobody shared the row is removed, as
// before.

export interface RowEnvelope {
  table: SyncedTable
  author: string
  version: number
  // The Case the row belongs to (caseOfRow); null for a tag, which belongs
  // to Cases through its applications.
  caseId: string | null
  deletedAt: string | null
  fields: RowFields
}

export function rowDigest(envelope: RowEnvelope): string {
  return createHash('sha256').update(canonicalStringify(envelope)).digest('hex')
}

// The next version for a local write: above every version this installation
// has given a row, as the rows say and as the high-water mark in every
// Shared Case's sync state says. The mark survives a database restore, which
// the rows do not, so a restored installation never reissues a version a
// peer already holds. The mark is raised before the row is written: a mark
// above the rows loses nothing, a mark below them would.
export function allocateLocalVersion(): number {
  return allocateLocalVersions(1)
}

// `count` consecutive versions, the first returned, with the mark raised once to the last.
export function allocateLocalVersions(count: number): number {
  const first = Math.max(maxLocalVersion(), localVersionHighWater()) + 1
  recordLocalVersion(first + count - 1)
  return first
}

export interface SignOptions {
  // The tombstone to write; absent keeps the row's current one.
  deletedAt?: string | null
  // A version allocated by the caller, so a batch of writes shares one.
  version?: number
}

// Signs this installation's row under `key` as it is stored now, with a fresh
// version. Runs inside the caller's transaction when there is one. An
// annotation layer, pin or tag application must name a Capture or Exhibit
// this database holds, or, for a tombstone, one recorded as deleted: the
// check the foreign keys made before v41 (#1877), so no row is ever signed
// with no Case. A note is not held to it, so its author can still edit a note
// that keeps its link to a deleted Capture; createNote checks a new link.
export function signLocalRow(
  table: SyncedTable,
  key: RowKey,
  options: SignOptions = {}
): StoredRow {
  return withTransaction(() => {
    const row = readRow(table, key, null)
    if (!row) throw new Error(`${table} row to sign is missing`)
    const version = options.version ?? allocateLocalVersion()
    const deletedAt = options.deletedAt === undefined ? row.deletedAt : options.deletedAt
    const reference = table === 'notes' ? null : referenceOf(table, row.fields)
    if (
      reference !== null &&
      reference.state !== 'live' &&
      (deletedAt === null || reference.state === 'missing')
    ) {
      throw referenceError(
        `${table} row names ${reference.noun} ${reference.id}, which this copy does not hold`
      )
    }
    const digest = rowDigest({
      table,
      author: getInstallationId(),
      version,
      caseId: caseOfRow(table, row.fields) ?? null,
      deletedAt,
      fields: row.fields
    })
    const signature = signEntryHash(digest)
    writeRowSync(table, key, { version, deletedAt, signature })
    return { ...row, version, deletedAt, signature }
  })
}

// Deletes this installation's live row under `key`: a tombstone, re-signed,
// when the row belongs to a Shared Case; removed outright otherwise. False
// when there is no live local row to delete.
export function deleteLocalRow(table: SyncedTable, key: RowKey): boolean {
  return withTransaction(() => {
    const row = readRow(table, key, null)
    if (!row || row.deletedAt !== null) return false
    if (isInSharedCase(table, key)) {
      signLocalRow(table, key, { deletedAt: new Date().toISOString() })
      return true
    }
    return hardDeleteLocalRow(table, key)
  })
}

// The working-layer rows on a Capture about to be deleted (#1877, ruling of
// 21 October 2026), inside the transaction that deletes it and before its
// Capture and Exhibit rows go, while they still name its Case. In a Shared
// Case, on the author's copy and on a copy applying the author's deletion
// alike, this installation's own annotation layer, pins and tag applications
// on it are tombstoned at one version, so they travel as one group, and the
// deletion is recorded; every other author's row, and every note of a Shared
// Case, stays as signed, and a note of a Case nobody shared loses its link.
// In a Case nobody shared the rows go as the foreign keys took them.
// A Capture no other member reads (`chained` false: a legacy html Capture, or
// one whose entry sits before this chain's `import`) never reaches another
// member, so no peer could place a tombstone of it: this installation's rows
// on it are removed instead. The deletion is still recorded: the record stays
// on this copy and keeps the id dead for the notes that keep their link.
export function settleRowsOnDeletedCapture(
  captureId: string,
  caseId: string,
  chained: boolean
): void {
  withTransaction(() => {
    if (!isSharedCaseId(caseId)) {
      removeExhibitDependents(captureId)
      removeCaptureDependents(captureId)
      return
    }
    clearUnsharedNoteLinks(captureId)
    if (!chained) {
      removeOwnRowsOnCapture(captureId)
    } else {
      const own = ownLiveRowsOnCapture(captureId)
      if (own.length > 0) {
        const version = allocateLocalVersion()
        const deletedAt = new Date().toISOString()
        for (const { table, key } of own) signLocalRow(table, key, { deletedAt, version })
      }
    }
    recordDeletedCapture(captureId, caseId)
  })
}

export interface OlderRowsReach {
  // Whether a member's copy can hold the Capture or Exhibit with this id.
  membersHold: (id: string) => boolean
  // The Case's chain imports an archive. The exporter's rows arrived with no author and read
  // as this installation's, and nothing the import records proves who exported it, so only a
  // row that needs a Capture or Exhibit a member can hold, which this installation created
  // after the import, is known to be its own; nothing is signed for another author.
  imported: boolean
}

// The rows a tag application's foreign keys name, which a member's copy must hold too.
const PARENT_ROWS: Partial<Record<SyncedTable, Array<{ parent: SyncedTable; column: string }>>> = {
  exhibit_tags: [{ parent: 'tags', column: 'tag_id' }],
  note_tags: [
    { parent: 'notes', column: 'note_id' },
    { parent: 'tags', column: 'tag_id' }
  ]
}

// Whether this installation's stored row verifies as a member's copy checks it once offered.
// An archive import keeps a signature made over the source Case, and #1877 clears a note's
// link without re-signing it, so a signed row can fail.
function verifiesAsOwn(row: StoredRow): boolean {
  const [wire] = toWireRows([row], getInstallationId())
  return wire !== undefined && verifyWireRow(wire, getPublicKeyPem())
}

// The Owner's rows a Case held before rows were signed (#1910, rulings of 21 and 22 October
// 2026), signed when the Case is first shared, inside the transaction that marks it shared, so
// the first sync offers them. Each row takes its own version, so the backlog pages like any
// other writes, and each is checked as a new write is (signLocalRow), which refuses a live row
// on a Capture recorded as deleted (#1877). Only rows provably the Owner's are signed. An
// older tag never is: tags are global, and one an archive brought, the demo Case's among them,
// carries the same id on every installation that imported it. A row stays local and unsigned
// when a member's copy would refuse it and, with it, every row of that session: one that needs
// a Capture or Exhibit no member can hold (`membersHold` false), and a tag application whose
// note or tag does not arrive with it, because that row stays unsigned or is this
// installation's row signed over content it no longer holds (verifiesAsOwn). A row another copy
// may hold under its id is the caller's to rule out: the first share does not call this for a
// Case whose chain records an archive export or holds a line that does not parse (membership.ts).
// Returns the number of rows signed.
export function signOwnUnsignedRows(caseId: string, reach: OlderRowsReach): number {
  return withTransaction(() => {
    const { membersHold, imported } = reach
    const candidates = ownUnsignedRowsInCase(caseId).filter(({ table, needs }) => {
      if (table === 'tags') return false
      return needs === null ? !imported : membersHold(needs)
    })
    const name = (table: SyncedTable, key: RowKey): string => `${table} ${JSON.stringify(key)}`
    const signing = new Set(candidates.map(({ table, key }) => name(table, key)))
    const arrives = (table: SyncedTable, key: RowKey): boolean => {
      if (signing.has(name(table, key))) return true
      // No row of this installation: the parent is another author's, which that author sends.
      const own = readRow(table, key, null)
      return own === undefined || verifiesAsOwn(own)
    }
    const rows = candidates.filter(({ table, key }) =>
      (PARENT_ROWS[table] ?? []).every(({ parent, column }) => arrives(parent, { id: key[column] }))
    )
    if (rows.length === 0) return 0
    const first = allocateLocalVersions(rows.length)
    rows.forEach(({ table, key }, i) => signLocalRow(table, key, { version: first + i }))
    return rows.length
  })
}

export type EnsureOutcome = 'inserted' | 'restored' | 'unchanged'

// Makes sure this installation holds a live row under `key`: a tombstoned
// one is restored and re-signed, an absent one is written by `insert` and
// signed, a live one is left as it is.
export function ensureLocalRow(
  table: SyncedTable,
  key: RowKey,
  insert: () => void,
  version?: number
): EnsureOutcome {
  return withTransaction(() => {
    const row = readRow(table, key, null)
    if (row && row.deletedAt === null) return 'unchanged'
    if (row) {
      signLocalRow(table, key, { deletedAt: null, version })
      return 'restored'
    }
    insert()
    signLocalRow(table, key, { version })
    return 'inserted'
  })
}

export interface RowPage {
  rows: WireRow[]
  more: boolean
}

// One page of an author's rows from what the tables offer (rowsOfAuthorByTable):
// every cursor-free row, then the cursor-bound rows in version order up to
// the highest version every table is complete to. A table whose offer is
// not complete holds more above its last version, so nothing above that
// version is known to be complete and is left for the next page. The page is
// cut again at a version boundary once `maxBytes` is reached, measured on the
// rows' JSON, which is close to their CBOR; the first version group always
// travels whole, so a page always makes progress and never splits a group.
// `more` says rows above the page remain, so the dialer asks again from the
// page's cursor (`cursorAfter`).
export function offerPage(byTable: Map<string, TableOffer<WireRow>>, maxBytes: number): RowPage {
  const byVersion = (a: WireRow, b: WireRow): number => a.version - b.version
  const free: WireRow[] = []
  const bound: WireRow[] = []
  let ceiling = Number.POSITIVE_INFINITY
  let more = false
  for (const [table, { rows, complete }] of byTable) {
    if (CURSOR_FREE_TABLES.has(table)) {
      free.push(...rows)
      continue
    }
    bound.push(...rows)
    if (!complete) {
      more = true
      if (rows.length > 0) ceiling = Math.min(ceiling, rows[rows.length - 1].version)
    }
  }
  free.sort(byVersion)
  const complete = bound.filter((row) => row.version <= ceiling).sort(byVersion)
  const size = (row: WireRow): number => JSON.stringify(row).length
  let bytes = free.reduce((total, row) => total + size(row), 0)
  const page: WireRow[] = []
  for (let i = 0; i < complete.length; i++) {
    const row = complete[i]
    const startsGroup = i === 0 || row.version !== complete[i - 1].version
    if (startsGroup && page.length > 0 && bytes + size(row) > maxBytes) {
      more = true
      break
    }
    page.push(row)
    bytes += size(row)
  }
  return { rows: [...free, ...page], more }
}

// The cursor a page moves the dialer to: the highest version among its
// cursor-bound rows, or `since` when it carried none. A cursor-free row
// travels on every page whatever its version and must move nothing, or the
// cursor-bound rows between would never be asked for.
export function cursorAfter(
  rows: ReadonlyArray<{ table: string; version: number }>,
  since: number
): number {
  return rows.reduce(
    (max, row) => (CURSOR_FREE_TABLES.has(row.table) ? max : Math.max(max, row.version)),
    since
  )
}

// Rows as they travel: this installation's carry its id in place of NULL,
// and each names its Case as this database reads it, which for a row that
// was received is the Case its author signed (caseRefusal).
export function toWireRows(rows: StoredRow[], localInstallationId: string): WireRow[] {
  return rows.flatMap(({ table, author, version, deletedAt, signature, fields }) =>
    signature === null
      ? []
      : [
          {
            table,
            author: author ?? localInstallationId,
            version,
            caseId: caseOfRow(table, fields) ?? null,
            deletedAt,
            fields,
            signature
          }
        ]
  )
}

// Whether a received row is exactly a row of a synced table, with exactly
// that table's content columns, signed by the key given over its envelope.
export function verifyWireRow(row: WireRow, publicKeyPem: string): boolean {
  if (!isSyncedTable(row.table)) return false
  const columns = signedColumns(row.table)
  const keys = Object.keys(row.fields)
  if (keys.length !== columns.length || !columns.every((c) => keys.includes(c))) return false
  const digest = rowDigest({
    table: row.table,
    author: row.author,
    version: row.version,
    caseId: row.caseId,
    deletedAt: row.deletedAt,
    fields: row.fields
  })
  return verifyEntrySignature(digest, row.signature, publicKeyPem)
}

// Why a verified row is not this Case's, or null. Its signed envelope must
// name the Case being synced (a tag names none), and the Case this replica
// reads for it, from its own column or from the Exhibit, Note or Capture it
// references, must be that Case whenever the referenced row is held here or
// recorded as deleted (caseOfRow); a row referencing one neither held nor
// recorded fails applyRows' reference check, which rolls the session back.
// A note's Capture column and anchor are held to the same rule a local write
// is (noteReferencedCases): an anchor naming a row not held here is kept, as
// locally, and one naming a row of another Case is refused.
function caseRefusal(row: WireRow, caseId: string): string | null {
  const held = caseOfRow(row.table as SyncedTable, row.fields)
  if (held === null) return row.caseId === null ? null : 'a tag names no Case'
  if (row.caseId !== caseId) return `names Case ${row.caseId}, this session syncs ${caseId}`
  if (held !== undefined && held !== caseId) return `references a row of Case ${held}`
  if (row.table === 'notes') {
    let referenced: string[]
    try {
      referenced = noteReferencedCases(row.fields)
    } catch (err) {
      return `anchor refused: ${(err as Error).message}`
    }
    const other = referenced.find((id) => id !== caseId)
    if (other !== undefined) return `references a row of Case ${other}`
  }
  return null
}

export interface RowRefusal {
  kind: SyncErrorKind
  detail: string
  installationId: string
}

export interface RemoteApplyOutcome {
  applied: number
  skipped: number
  refused: RowRefusal[]
}

export interface VerifiedRows {
  accepted: RemoteRow[]
  refused: RowRefusal[]
}

// Checks received rows before any is applied. A row is refused when it names
// an author this replica did not ask for, one the roster does not hold a key
// for, a table that does not sync, when its signature does not verify, or
// when it is not a row of `caseId`, the Case being synced (caseRefusal).
// What a page moves the cursor to is read from the accepted rows alone, so a
// peer answering with rows that do not verify moves nothing.
export function verifyRemoteRows(
  rows: WireRow[],
  roster: CaseMember[],
  requested: ReadonlySet<string>,
  caseId: string
): VerifiedRows {
  const accepted: RemoteRow[] = []
  const refused: RowRefusal[] = []
  const refuse = (installationId: string, detail: string): void => {
    refused.push({ kind: 'rejected-entry', detail, installationId })
  }
  for (const row of rows) {
    const { author, table, version } = row
    const member = roster.find((m) => m.installationId === author)
    const name = `${table} row of ${author} at version ${version}`
    if (!requested.has(author)) {
      refuse(author, `${name}: author not requested`)
      continue
    }
    if (!member) {
      refuse(author, `${name}: author not on the roster`)
      continue
    }
    if (!isSyncedTable(table)) {
      refuse(author, `${name}: table does not sync`)
      continue
    }
    if (!verifyWireRow(row, member.publicKeyPem)) {
      refuse(author, `${name}: invalid signature`)
      continue
    }
    const elsewhere = caseRefusal(row, caseId)
    if (elsewhere !== null) {
      refuse(author, `${name}: ${elsewhere}`)
      continue
    }
    accepted.push({ ...row, table })
  }
  return { accepted, refused }
}

// Refuse demonstrated id collisions and their tag applications individually, after all pages
// verify. Keeping a colliding tag's application would attach it to the held author's tag.
export function applyVerifiedRows(rows: RemoteRow[], caseId: string): RemoteApplyOutcome {
  return withTransaction(() => {
    const collisions = new Map<RemoteRow, string>()
    const parentKey = (table: SyncedTable, id: RowFields[string]): string => `${table}\u0000${id}`
    const blocked = new Set<string>()
    for (const row of rows) {
      const collision = rowIdCollision(row)
      if (collision === null) continue
      collisions.set(row, collision)
      blocked.add(parentKey(row.table, row.fields.id))
    }
    const accepted: RemoteRow[] = []
    const refused: RowRefusal[] = []
    for (const row of rows) {
      const parent = (PARENT_ROWS[row.table] ?? []).find(({ parent, column }) =>
        blocked.has(parentKey(parent, row.fields[column]))
      )
      const reason =
        collisions.get(row) ??
        (parent
          ? `references colliding ${parent.parent} row ${row.fields[parent.column]}`
          : undefined)
      if (reason === undefined) {
        accepted.push(row)
      } else {
        refused.push({
          kind: 'rejected-entry',
          installationId: row.author,
          detail: `${row.table} row of ${row.author} at version ${row.version}: ${reason}`
        })
      }
    }
    const outcome = applyRows(accepted)
    const versions = new Map<string, number>()
    for (const row of rows) {
      if (CURSOR_FREE_TABLES.has(row.table)) continue
      versions.set(row.author, Math.max(versions.get(row.author) ?? 0, row.version))
    }
    for (const [author, version] of versions) recordAuthorRowCursor(caseId, author, version)
    return { ...outcome, refused }
  })
}

// Verifies received rows and applies the accepted ones in one transaction
// (applyRows); a batch whose references are not satisfied is refused whole.
// The session verifies page by page and applies once at its end; this is
// the one-batch form.
export function applyRemoteRows(
  rows: WireRow[],
  roster: CaseMember[],
  requested: ReadonlySet<string>,
  caseId: string
): RemoteApplyOutcome {
  const { accepted, refused } = verifyRemoteRows(rows, roster, requested, caseId)
  const outcome: RemoteApplyOutcome = { applied: 0, skipped: 0, refused }
  if (accepted.length === 0) return outcome
  try {
    const { applied, skipped, refused } = applyVerifiedRows(accepted, caseId)
    outcome.applied = applied
    outcome.skipped = skipped
    outcome.refused.push(...refused)
  } catch (err) {
    outcome.refused.push({
      kind: 'peer',
      detail: `rows received could not be applied: ${(err as Error).message}`,
      installationId: [...new Set(accepted.map((row) => row.author))].join(',')
    })
  }
  return outcome
}
