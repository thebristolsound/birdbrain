import { createHash } from 'crypto'
import type { CaseMember, SyncErrorKind } from '@shared/types'
import { canonicalStringify, verifyEntrySignature } from '@shared/verify'
import { withTransaction } from '@main/services/db/core'
import { getInstallationId } from '@main/services/installationId'
import { signEntryHash } from '@main/services/signingKey'
import {
  CURSOR_FREE_TABLES,
  applyAuthorRows,
  hardDeleteLocalRow,
  isInSharedCase,
  isSyncedTable,
  maxLocalVersion,
  readRow,
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
// envelope (table, author, version, tombstone, content columns), the same
// key and primitive a manifest entry uses. A remote row is applied only when
// that envelope verifies under the key the roster holds for its author, and
// only above the version already stored for it.
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
  const version = Math.max(maxLocalVersion(), localVersionHighWater()) + 1
  recordLocalVersion(version)
  return version
}

export interface SignOptions {
  // The tombstone to write; absent keeps the row's current one.
  deletedAt?: string | null
  // A version allocated by the caller, so a batch of writes shares one.
  version?: number
}

// Signs this installation's row under `key` as it is stored now, with a fresh
// version. Runs inside the caller's transaction when there is one.
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
    const digest = rowDigest({
      table,
      author: getInstallationId(),
      version,
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
export function cursorAfter(rows: WireRow[], since: number): number {
  return rows.reduce(
    (max, row) => (CURSOR_FREE_TABLES.has(row.table) ? max : Math.max(max, row.version)),
    since
  )
}

// Rows as they travel: this installation's carry its id in place of NULL.
export function toWireRows(rows: StoredRow[], localInstallationId: string): WireRow[] {
  return rows.flatMap(({ table, author, version, deletedAt, signature, fields }) =>
    signature === null
      ? []
      : [{ table, author: author ?? localInstallationId, version, deletedAt, fields, signature }]
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
    deletedAt: row.deletedAt,
    fields: row.fields
  })
  return verifyEntrySignature(digest, row.signature, publicKeyPem)
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

// Applies received rows author by author, in roster order, each author's
// batch in one transaction. A row is refused when it names an author this
// replica did not ask for, one the roster does not hold a key for, a table
// that does not sync, or when its signature does not verify; a batch whose
// references are not satisfied is refused whole and retried next session.
export function applyRemoteRows(
  rows: WireRow[],
  roster: CaseMember[],
  requested: ReadonlySet<string>
): RemoteApplyOutcome {
  const outcome: RemoteApplyOutcome = { applied: 0, skipped: 0, refused: [] }
  const byAuthor = new Map<string, RemoteRow[]>()
  const refuse = (installationId: string, detail: string): void => {
    outcome.refused.push({ kind: 'rejected-entry', detail, installationId })
  }
  for (const row of rows) {
    const { author, table, version } = row
    const member = roster.find((m) => m.installationId === author)
    if (!requested.has(author)) {
      refuse(author, `${table} row of ${author} at version ${version}: author not requested`)
    } else if (!member) {
      refuse(author, `${table} row of ${author} at version ${version}: author not on the roster`)
    } else if (!isSyncedTable(table)) {
      refuse(author, `${table} row of ${author} at version ${version}: table does not sync`)
    } else if (!verifyWireRow(row, member.publicKeyPem)) {
      refuse(author, `${table} row of ${author} at version ${version}: invalid signature`)
    } else {
      const batch = byAuthor.get(author) ?? []
      batch.push({ ...row, table })
      byAuthor.set(author, batch)
    }
  }
  for (const member of roster) {
    const batch = byAuthor.get(member.installationId)
    if (!batch) continue
    try {
      const { applied, skipped } = applyAuthorRows(batch)
      outcome.applied += applied
      outcome.skipped += skipped
    } catch (err) {
      outcome.refused.push({
        kind: 'peer',
        detail: `rows of ${member.installationId} could not be applied: ${(err as Error).message}`,
        installationId: member.installationId
      })
    }
  }
  return outcome
}
