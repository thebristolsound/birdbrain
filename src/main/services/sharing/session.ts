import { createHash, randomBytes } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { ManifestEntrySchema, type ManifestEntry } from '@shared/schemas'
import type { CaseMember, SyncErrorKind } from '@shared/types'
import { acceptedHeadBefore, canonicalStringify, verifyEntrySignature } from '@shared/verify'
import { listCaseMembers, upsertCaseMember } from '@main/services/db/caseMemberRepo'
import { getInstallationId } from '@main/services/installationId'
import { signEntryHash } from '@main/services/signingKey'
import {
  appendManifestEntry,
  head,
  readChainFileSnapshots,
  readEntries,
  readManifestSnapshot,
  readMemberChainText,
  truncateMemberChainLines
} from '@main/services/manifest'
import { getSettings } from '@main/services/settings'
import { getStorageRoot } from '@main/services/storage'
import { resolveToolVersion } from '@main/services/toolVersion'
import { defaultCaptureStore } from '@main/services/captureStore'
import {
  acceptEntrySegment,
  foreignCaseEntry,
  linesWithinBytes,
  nonEmptyLines,
  type ChainHeadRef
} from '@main/services/sharing/entryAcceptance'
import {
  acceptBlob,
  anchoredFiles,
  missingAnchoredFiles,
  safeCasePath
} from '@main/services/sharing/blobAcceptance'
import {
  cursorAfter,
  offerPage,
  toWireRows,
  verifyRemoteRows,
  type RowPage
} from '@main/services/sharing/workingRows'
import { beginSession, finishSession, writeMembersFile } from '@main/services/sharing/syncState'
import { isChainInstallationId } from '../../../packages/evidence-package-layout/index'
import {
  applyRows,
  maxAuthorVersionInCase,
  rowsOfAuthorByTable,
  type RemoteRow,
  type TableOffer
} from '@main/services/db/workingRowRepo'
import {
  CHALLENGE_BYTES,
  MessageReader,
  PeerByeError,
  ProtocolError,
  expectMessage,
  writeMessage,
  type ChainHead,
  type WireRow
} from '@main/services/sharing/messages'
import type { ByteStream } from '@main/services/sharing/transport'

// The sync session (docs/specs/2026-09-19-collaborative-cases-design.md,
// "Sync session"): pull-only, over one bidirectional stream. The dialer runs
// `pullFromPeer` and is the only side that writes anything to its replica; the
// listener runs `serveSyncSession` and answers requests from a `SyncSource`.
// Both sides prove who they are in `hello`: each signs the other's challenge
// with its installation key, and each checks the signature against the key
// the roster holds for that installation. A peer the roster does not name, or
// names as revoked, gets `bye` and nothing else; the listener re-reads its
// roster before every request, so a revocation mid-session ends the session
// at the next request.
//
// Because nothing is pushed, a peer can only offer entries, files and rows:
// what the dialer stores is decided by entryAcceptance, blobAcceptance and
// workingRows, never by anything the peer says.

// What a listening peer serves, read live at request time.
export interface SyncSource {
  installationId: string
  caseId: string
  roster(): CaseMember[]
  heads(): ChainHead[]
  // One page of the raw lines of a chain this peer holds, from `fromIndex`
  // on and under `maxBytes` (linesWithinBytes); [] for a chain it does not
  // hold.
  chainLines(installationId: string, fromIndex: number, maxBytes: number): string[]
  // The bytes at a storage-root-relative path inside the Case directory, or
  // null when this peer does not hold the file or the path is not one it
  // serves.
  blob(path: string): Uint8Array | null
  // One page of the signed working-layer rows of `author` in the Case above
  // `sinceVersion` (offerPage), this peer's own rows included under its own
  // id.
  rowsSince(author: string, sinceVersion: number, maxBytes: number): RowPage
  sign(hex: string): string
}

// The budget one answer is cut to. Well under MAX_FRAME_BYTES, so a page and
// its envelope always fit one frame; a member with more than this to send
// is answered in as many pages as it takes.
export const PAGE_BYTES = 4 * 1024 * 1024

// The most pages of one author's rows a session asks for. A listener that
// keeps answering `more` with rows that verify is bounded here; one whose
// rows do not verify moves no cursor and is stopped by the progress check.
export const MAX_ROW_PAGES = 1000

export interface ServeOptions {
  pageBytes?: number
}

export type SyncPhase = 'hello' | 'heads' | 'entries' | 'blobs' | 'rows' | 'merge'

export interface SyncError {
  kind: SyncErrorKind
  detail: string
  installationId?: string
  index?: number
}

export interface SyncSessionResult {
  // Set once the peer proved it is the roster member it claims to be.
  peerInstallationId: string | null
  entriesReceived: number
  blobsReceived: number
  bytesReceived: number
  rowsApplied: number
  // Index of the `merge` entry this session wrote, or null on a session that
  // brought no new entry.
  mergeIndex: number | null
  errors: SyncError[]
}

export interface SyncSessionOptions {
  onPhase?: (phase: SyncPhase) => void
}

// Why a listener ends a session before serving it; sent in `bye`.
export const BYE_REASONS = {
  notMember: 'not-a-member',
  revoked: 'revoked',
  unknownCase: 'unknown-case',
  ownInstallation: 'own-installation',
  badProof: 'bad-proof',
  protocol: 'protocol-error',
  done: 'done'
} as const

// The string a side signs to prove it holds the key the roster names: bound
// to the Case and to the signer, so a proof cannot be replayed into another
// Case or claimed by another member.
export function helloDigest(caseId: string, challenge: Uint8Array, signer: string): string {
  const body = {
    purpose: 'birdbrain-sync-hello',
    caseId,
    challenge: Buffer.from(challenge).toString('hex'),
    signer
  }
  return createHash('sha256').update(canonicalStringify(body)).digest('hex')
}

// The roster's reason to refuse an installation, or null when it is a member
// in good standing.
export function membershipRefusal(
  roster: CaseMember[],
  installationId: string
): typeof BYE_REASONS.notMember | typeof BYE_REASONS.revoked | null {
  const member = roster.find((m) => m.installationId === installationId)
  if (!member) return BYE_REASONS.notMember
  if (member.revokedAtIndex !== null) return BYE_REASONS.revoked
  return null
}

// Every chain head a Case directory holds: the local chain under this
// installation's id, and each other member's chain file. A lineage chain is
// a forked Case's history and is not synced.
export function caseChainHeads(caseDir: string, localInstallationId: string): ChainHead[] {
  const heads: ChainHead[] = []
  const own = readManifestSnapshot(caseDir).head
  if (own) heads.push({ installationId: localInstallationId, ...own })
  for (const chain of readChainFileSnapshots(caseDir)) {
    if (chain.sourceCaseId !== undefined) continue
    const ref = head(readEntries(chain.jsonl.toString('utf-8')))
    if (ref) heads.push({ installationId: chain.installationId, ...ref })
  }
  return heads
}

// The source a listening installation serves a Case from. Null for a Case
// nobody shared: it has no roster, so no peer could prove membership.
export function liveSyncSource(caseId: string): SyncSource | null {
  if (listCaseMembers(caseId).length === 0) return null
  const installationId = getInstallationId()
  const caseDir = join(getStorageRoot(), caseId)
  return {
    installationId,
    caseId,
    roster: () => listCaseMembers(caseId),
    heads: () => caseChainHeads(caseDir, installationId),
    chainLines: (member, fromIndex, maxBytes) => {
      if (member === installationId) {
        const own = nonEmptyLines(readManifestSnapshot(caseDir).jsonl.toString('utf-8'))
        return linesWithinBytes(own.slice(fromIndex), maxBytes)
      }
      // Only a roster member's chain is served, and only when its id can
      // name a chain file: the id arrived on the wire, and a file name built
      // from an unchecked one reaches outside the Case directory.
      const held = listCaseMembers(caseId).some((m) => m.installationId === member)
      if (!held || !isChainInstallationId(member)) return []
      const lines = nonEmptyLines(readMemberChainText(caseDir, member))
      return linesWithinBytes(lines.slice(fromIndex), maxBytes)
    },
    blob: (path) => {
      const abs = safeCasePath(getStorageRoot(), caseId, path)
      return abs !== null && existsSync(abs) ? Uint8Array.from(readFileSync(abs)) : null
    },
    rowsSince: (author, sinceVersion, maxBytes) => {
      const byTable = new Map<string, TableOffer<WireRow>>()
      const offered = rowsOfAuthorByTable(
        caseId,
        author === installationId ? null : author,
        sinceVersion
      )
      for (const [table, { rows, complete }] of offered) {
        byTable.set(table, { rows: toWireRows(rows, installationId), complete })
      }
      return offerPage(byTable, maxBytes)
    },
    sign: signEntryHash
  }
}

// The entries a stored member chain holds. Every line was verified under the
// member's key before it was stored, so every line parses; one that does not
// is skipped rather than trusted.
function storedEntries(jsonl: Buffer): ManifestEntry[] {
  return readEntries(jsonl.toString('utf-8')).flatMap((raw) => {
    const parsed = ManifestEntrySchema.safeParse(raw)
    return parsed.success ? [parsed.data] : []
  })
}

// Membership is the Owner's to write (sharedCase.ts). Entries newly accepted
// from the Owner's chain update the roster cache, which is how a member learns
// who joined or was revoked after it did. The lines verified under the
// Owner's key before they reached here. Returns what could not be applied.
function refreshRosterFromOwnerChain(caseId: string, lines: string[]): string[] {
  const refused: string[] = []
  for (const line of lines) {
    const parsed = ManifestEntrySchema.safeParse(JSON.parse(line))
    if (!parsed.success) continue
    const entry = parsed.data
    if (entry.type !== 'member-add' && entry.type !== 'member-revoke') continue
    // The id names that member's chain file on every replica; one that is
    // not a single path segment is refused here rather than written to.
    if (!isChainInstallationId(entry.memberInstallationId)) {
      refused.push(
        `${entry.type} at index ${entry.index}: installation id ${JSON.stringify(entry.memberInstallationId)} cannot name a chain file`
      )
      continue
    }
    const existing = listCaseMembers(caseId).find(
      (m) => m.installationId === entry.memberInstallationId
    )
    try {
      if (entry.type === 'member-add' && !existing) {
        upsertCaseMember({
          caseId,
          installationId: entry.memberInstallationId,
          publicKeyPem: entry.memberPublicKeyPem,
          memberCode: entry.memberCode,
          operatorName: entry.memberOperatorName,
          nodeId: entry.nodeId,
          role: entry.role,
          addedAtIndex: entry.index,
          revokedAtIndex: null
        })
      } else if (entry.type === 'member-revoke' && existing && existing.revokedAtIndex === null) {
        upsertCaseMember({ ...existing, revokedAtIndex: entry.index })
      }
    } catch (err) {
      refused.push(`${entry.type} at index ${entry.index}: ${(err as Error).message}`)
    }
  }
  return refused
}

async function sayBye(stream: ByteStream, reason: string): Promise<void> {
  try {
    await writeMessage(stream, { t: 'bye', reason })
  } catch {
    // The peer may already be gone; the session is over either way.
  }
}

// The listening side. `sourceFor` resolves the Case the dialer names, or null
// when this installation does not share it.
export async function serveSyncSession(
  stream: ByteStream,
  sourceFor: (caseId: string) => SyncSource | null,
  serveOptions: ServeOptions = {}
): Promise<void> {
  const pageBytes = serveOptions.pageBytes ?? PAGE_BYTES
  const reader = new MessageReader(stream)
  try {
    const hello = await expectMessage(reader, 'hello')
    const source = sourceFor(hello.caseId)
    if (!source) return await sayBye(stream, BYE_REASONS.unknownCase)
    const peerId = hello.installationId
    if (peerId === source.installationId) return await sayBye(stream, BYE_REASONS.ownInstallation)
    const refusal = membershipRefusal(source.roster(), peerId)
    if (refusal) return await sayBye(stream, refusal)

    const challenge = randomBytes(CHALLENGE_BYTES)
    await writeMessage(stream, {
      t: 'hello',
      caseId: source.caseId,
      installationId: source.installationId,
      challenge,
      proof: source.sign(helloDigest(source.caseId, hello.challenge, source.installationId))
    })
    const { signature } = await expectMessage(reader, 'proof')
    const member = source.roster().find((m) => m.installationId === peerId)
    const expected = helloDigest(source.caseId, challenge, peerId)
    if (!member || !verifyEntrySignature(expected, signature, member.publicKeyPem)) {
      return await sayBye(stream, BYE_REASONS.badProof)
    }

    for (let message = await reader.next(); message !== null; message = await reader.next()) {
      if (message.t === 'bye') return
      // Re-read before every request: a `member-revoke` written during the
      // session ends it here, before another entry, file or row goes out.
      const refusedNow = membershipRefusal(source.roster(), peerId)
      if (refusedNow) return await sayBye(stream, refusedNow)
      switch (message.t) {
        case 'heads':
          await writeMessage(stream, { t: 'heads', heads: source.heads() })
          break
        case 'entries-request': {
          const { installationId, fromIndex } = message
          const lines = source.chainLines(installationId, fromIndex, pageBytes)
          await writeMessage(stream, { t: 'entries', installationId, fromIndex, lines })
          break
        }
        case 'blobs-request':
          for (const path of message.paths) {
            await writeMessage(stream, { t: 'blobs', path, bytes: source.blob(path) })
          }
          break
        case 'rows-request': {
          const { installationId, sinceVersion } = message
          const { rows, more } = source.rowsSince(installationId, sinceVersion, pageBytes)
          await writeMessage(stream, { t: 'rows', installationId, sinceVersion, rows, more })
          break
        }
        default:
          return await sayBye(stream, BYE_REASONS.protocol)
      }
    }
  } catch (err) {
    if (err instanceof PeerByeError) return
    if (err instanceof ProtocolError) return await sayBye(stream, BYE_REASONS.protocol)
    throw err
  } finally {
    stream.close()
  }
}

// The dialing side: pulls everything the peer holds that this replica lacks.
export async function pullFromPeer(
  caseId: string,
  stream: ByteStream,
  options: SyncSessionOptions = {}
): Promise<SyncSessionResult> {
  let roster = listCaseMembers(caseId)
  if (roster.length === 0) throw new Error(`Case ${caseId} is not a Shared Case`)
  const self = getInstallationId()
  const caseDir = join(getStorageRoot(), caseId)
  const reader = new MessageReader(stream)
  const result: SyncSessionResult = {
    peerInstallationId: null,
    entriesReceived: 0,
    blobsReceived: 0,
    bytesReceived: 0,
    rowsApplied: 0,
    mergeIndex: null,
    errors: []
  }
  const fail = (kind: SyncErrorKind, detail: string): void => {
    result.errors.push({ kind, detail })
  }
  beginSession(caseId)
  try {
    options.onPhase?.('hello')
    const challenge = randomBytes(CHALLENGE_BYTES)
    await writeMessage(stream, {
      t: 'hello',
      caseId,
      installationId: self,
      challenge,
      proof: null
    })
    const hello = await expectMessage(reader, 'hello')
    const peer = roster.find((m) => m.installationId === hello.installationId)
    const refusal = hello.caseId === caseId ? membershipRefusal(roster, hello.installationId) : null
    if (hello.caseId !== caseId) {
      fail('peer', `peer answered for Case ${hello.caseId}`)
      await sayBye(stream, BYE_REASONS.unknownCase)
      return result
    }
    if (!peer || refusal) {
      fail('peer', `peer ${hello.installationId} is ${refusal}`)
      await sayBye(stream, refusal ?? BYE_REASONS.notMember)
      return result
    }
    const expected = helloDigest(caseId, challenge, peer.installationId)
    if (hello.proof === null || !verifyEntrySignature(expected, hello.proof, peer.publicKeyPem)) {
      fail('peer', `peer ${peer.installationId} failed to prove its key`)
      await sayBye(stream, BYE_REASONS.badProof)
      return result
    }
    result.peerInstallationId = peer.installationId
    await writeMessage(stream, {
      t: 'proof',
      signature: signEntryHash(helloDigest(caseId, hello.challenge, self))
    })

    options.onPhase?.('heads')
    await writeMessage(stream, { t: 'heads', heads: caseChainHeads(caseDir, self) })
    const { heads } = await expectMessage(reader, 'heads')

    // 3. Entries: every chain the peer holds past what this replica stores,
    // one request per member, accepted segment by segment. A chain of an
    // installation the roster does not name has no key to verify it under
    // and is not asked for; the verify walk reports it as unknown-member.
    options.onPhase?.('entries')
    const ownerId = roster.find((m) => m.role === 'owner')?.installationId
    const advanced: Array<{
      installationId: string
      index: number
      entryHash: string
      entriesReceived: number
    }> = []
    // The Owner's chain as this replica holds it: the roster and every
    // revocation bound are read from it, so it is accepted before any other.
    const ownerEntries = (): ManifestEntry[] =>
      ownerId === undefined
        ? []
        : storedEntries(
            ownerId === self
              ? readManifestSnapshot(caseDir).jsonl
              : Buffer.from(readMemberChainText(caseDir, ownerId))
          )
    const ownerFirst = [...heads].sort(
      (a, b) => Number(b.installationId === ownerId) - Number(a.installationId === ownerId)
    )
    for (const remote of ownerFirst) {
      const member = roster.find((m) => m.installationId === remote.installationId)
      if (!member || member.installationId === self) continue
      // A revoked member's chain is accepted only to the head the Owner
      // merged before revoking it, the bound the Shared Case walk accepts to
      // (sharedCase.ts); its later entries are reported by verification, not
      // stored (decision 11). A member the Owner never merged has no bound.
      let bound: number | undefined
      if (member.revokedAtIndex !== null) {
        bound = acceptedHeadBefore(ownerEntries(), member.revokedAtIndex, member.installationId)
        if (bound === undefined) continue
      }
      if (!isChainInstallationId(member.installationId)) {
        result.errors.push({
          kind: 'rejected-entry',
          detail: `installation id ${JSON.stringify(member.installationId)} cannot name a chain file`,
          installationId: member.installationId
        })
        continue
      }
      const { installationId } = member
      let storedCount = nonEmptyLines(readMemberChainText(caseDir, installationId)).length
      const storedBefore = storedCount
      let received = 0
      let head: ChainHeadRef | null = null
      // One request per page, from the stored head, until the peer's head or
      // the bound is reached. A page that is refused, or that stops the
      // chain, ends this member's loop; the next session asks again.
      while (storedCount <= remote.index && (bound === undefined || storedCount <= bound)) {
        await writeMessage(stream, { t: 'entries-request', installationId, fromIndex: storedCount })
        const entries = await expectMessage(reader, 'entries')
        if (entries.installationId !== installationId || entries.fromIndex !== storedCount) {
          throw new ProtocolError(
            `entries answered for ${entries.installationId}@${entries.fromIndex}`
          )
        }
        if (entries.lines.length === 0) break
        const acceptance = acceptEntrySegment({
          caseDir,
          member,
          fromIndex: storedCount,
          lines:
            bound === undefined ? entries.lines : entries.lines.slice(0, bound - storedCount + 1)
        })
        if (acceptance.outcome === 'rejected') {
          result.errors.push({
            kind: 'rejected-entry',
            detail: `entry ${acceptance.index} of ${installationId} refused: ${acceptance.reason}`,
            installationId,
            index: acceptance.index
          })
          break
        }
        if (acceptance.outcome === 'not-contiguous') {
          fail('peer', `chain of ${installationId} did not continue the stored head`)
          break
        }
        if (acceptance.outcome === 'newer-version') {
          result.errors.push({
            kind: 'newer-version',
            detail: `entry ${acceptance.index} of ${installationId}: ${acceptance.reason}`,
            installationId,
            index: acceptance.index
          })
        }
        if (acceptance.appended > 0 && acceptance.head !== null) {
          received += acceptance.appended
          head = acceptance.head
          storedCount += acceptance.appended
          if (installationId === ownerId) {
            const accepted = entries.lines.slice(0, acceptance.appended)
            for (const detail of refreshRosterFromOwnerChain(caseId, accepted)) {
              result.errors.push({ kind: 'rejected-entry', detail, installationId })
            }
            roster = listCaseMembers(caseId)
          }
        }
        if (acceptance.outcome === 'newer-version' || acceptance.appended === 0) break
      }
      if (received === 0 || head === null) continue
      // A chain names its Case in the entries after its last `import`; the
      // ones before are a source Case's history (sharedCase.ts). That is
      // judged over the whole chain once the peer's head is reached, since
      // the `import` may have arrived on a later page: a chain that names
      // another Case is cut back to what this session found.
      if (storedCount > remote.index) {
        const whole = storedEntries(Buffer.from(readMemberChainText(caseDir, installationId)))
        const foreign = foreignCaseEntry(whole, caseId)
        if (foreign) {
          truncateMemberChainLines(caseDir, installationId, storedBefore)
          result.errors.push({
            kind: 'rejected-entry',
            detail: `entry ${foreign.index} of ${installationId} names Case ${foreign.caseId}, this Case is ${caseId}`,
            installationId,
            index: foreign.index
          })
          continue
        }
      }
      result.entriesReceived += received
      advanced.push({ installationId, ...head, entriesReceived: received })
    }

    // 6. One `merge` per session that brought at least one new entry
    // (decision 14), naming the head now held for each chain that advanced.
    if (advanced.length > 0) {
      options.onPhase?.('merge')
      const { operatorName } = getSettings()
      const merge = appendManifestEntry(caseDir, {
        type: 'merge',
        caseId,
        heads: advanced,
        timestamp: new Date().toISOString(),
        operatorId: self,
        operatorName,
        toolVersion: resolveToolVersion()
      })
      result.mergeIndex = merge.index
    }

    // 4. Blobs: every file the stored chains of the other members anchor and
    // this replica lacks, one request per file, hash-checked on arrival. A
    // file the peer does not hold is left for a peer that does.
    options.onPhase?.('blobs')
    const storageRoot = getStorageRoot()
    const wanted = missingAnchoredFiles(
      readChainFileSnapshots(caseDir)
        .filter((chain) => chain.sourceCaseId === undefined)
        .flatMap((chain) => anchoredFiles(storedEntries(chain.jsonl), caseId, defaultCaptureStore)),
      storageRoot
    )
    for (const { path, hash } of wanted) {
      await writeMessage(stream, { t: 'blobs-request', paths: [path] })
      const blob = await expectMessage(reader, 'blobs')
      if (blob.path !== path) throw new ProtocolError(`blob answered for ${blob.path}`)
      if (blob.bytes === null) continue
      const acceptance = acceptBlob({
        storageRoot,
        caseId,
        path,
        expectedHash: hash,
        bytes: blob.bytes
      })
      if (acceptance.outcome === 'accepted') {
        result.blobsReceived += 1
        result.bytesReceived += acceptance.bytes
      } else if (acceptance.outcome === 'hash-mismatch') {
        fail(
          'hash-mismatch',
          `${path}: expected ${acceptance.expected}, received ${acceptance.actual}`
        )
      } else {
        fail('rejected-entry', `${path}: not a path inside this Case directory`)
      }
    }

    // 5. Rows: every other member's working-layer rows above the version this
    // replica holds for them, applied only under that member's signature and
    // only above the stored version (workingRows.ts). The cursor is read from
    // the rows themselves, so a database restore moves it back with them. A
    // revoked member's rows are not asked for: peers stop syncing with the
    // member (decision 11), and a row has no index to bound it by.
    options.onPhase?.('rows')
    const received: RemoteRow[] = []
    for (const member of roster) {
      if (member.installationId === self || member.revokedAtIndex !== null) continue
      const { installationId } = member
      let since = maxAuthorVersionInCase(caseId, installationId)
      // One request per page until the peer says nothing above the page
      // remains, at most MAX_ROW_PAGES. Each page is verified as it lands and
      // kept for the one apply below; the cursor moves on the verified rows
      // alone, so a peer answering with rows that do not verify moves
      // nothing and the loop ends.
      for (let pages = 0; pages < MAX_ROW_PAGES; pages++) {
        await writeMessage(stream, { t: 'rows-request', installationId, sinceVersion: since })
        const page = await expectMessage(reader, 'rows')
        if (page.installationId !== installationId || page.sinceVersion !== since) {
          throw new ProtocolError(`rows answered for ${page.installationId}@${page.sinceVersion}`)
        }
        const { accepted, refused } = verifyRemoteRows(page.rows, roster, new Set([installationId]))
        result.errors.push(...refused)
        received.push(...accepted)
        const top = cursorAfter(accepted, since)
        if (!page.more || top <= since) break
        since = top
      }
    }
    // Every row this session received lands in one transaction with foreign
    // keys deferred to its commit (the design's "Working-layer rows" rule,
    // ruling of 2026-10-15): a row may reference one from a later page or
    // another author. Until #1811 writes Capture rows for other members'
    // Captures, a row that references one this replica lacks rolls back the
    // session's rows as a whole; the next session asks from the same cursors.
    if (received.length > 0) {
      try {
        result.rowsApplied += applyRows(received).applied
      } catch (err) {
        fail('peer', `rows received this session could not be applied: ${(err as Error).message}`)
      }
    }

    await sayBye(stream, BYE_REASONS.done)
  } catch (err) {
    if (err instanceof PeerByeError) {
      fail('peer', `peer ended the session: ${err.reason}`)
    } else if (err instanceof ProtocolError) {
      fail('peer', err.message)
      await sayBye(stream, BYE_REASONS.protocol)
    } else {
      throw err
    }
  } finally {
    stream.close()
    // What the session leaves in sync-state.json: its transfer, its first
    // error, the heads now held, and the peer's last session. members.json
    // follows the roster, which the entries step may have changed.
    const [first] = result.errors
    const heads: Record<string, { index: number; entryHash: string }> = {}
    for (const { installationId, index, entryHash } of caseChainHeads(caseDir, self)) {
      heads[installationId] = { index, entryHash }
    }
    finishSession(caseId, {
      peerInstallationId: result.peerInstallationId,
      transfer: {
        entries: result.entriesReceived,
        blobs: result.blobsReceived,
        bytes: result.bytesReceived
      },
      error: first ? { kind: first.kind, detail: first.detail } : null,
      heads
    })
    writeMembersFile(caseId)
  }
  return result
}
