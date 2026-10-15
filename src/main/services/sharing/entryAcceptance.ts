import type { ManifestEntry } from '@shared/schemas'
import { verifyManifestChainText } from '@shared/verify'
import type { CaseMember } from '@shared/types'
import { appendMemberChainLines, readMemberChainText } from '@main/services/manifest'

// Acceptance of another member's chain entries (docs/specs/2026-09-19-
// collaborative-cases-design.md, "Sync session" step 3). A received segment
// is appended to `manifest.<installationId>.jsonl` only when the stored chain
// plus the segment verifies as one chain under the key that member's
// `member-add` carries, and only when the segment starts exactly where the
// stored chain ends. Nothing a peer sends is trusted: the verify-core walk
// decides, line by line, and a segment that fails is dropped whole.
//
// An entry from a newer Birdbrain is not a forgery (X25). verifyManifestChainText
// reports it as `unsupported` once every entry before it has verified and the
// entry itself sits where the chain says, hashes to what it claims and is
// signed by the member's key. The lines before it are appended, the chain
// stops there, and the session records `newer-version`; after an upgrade the
// next session asks for that index again and the chain resumes.

export interface ChainHeadRef {
  index: number
  entryHash: string
}

export type EntryAcceptance =
  // `lines` are the chain lines appended, one entry each, verified under the
  // member's key: what the caller may read entries from.
  | { outcome: 'accepted'; appended: number; head: ChainHeadRef | null; lines: string[] }
  // The segment did not start at the stored head. Nothing is appended; the
  // peer and this replica disagree about the chain, which is a peer fault.
  | { outcome: 'not-contiguous'; storedCount: number }
  // The chain plus the segment failed verification at `index`. Nothing is
  // appended.
  | { outcome: 'rejected'; index: number; reason: string }
  // Every line before `index` was appended; the entry at `index` is from a
  // newer schema than this build reads. `head` is the last line stored.
  | {
      outcome: 'newer-version'
      appended: number
      index: number
      reason: string
      head: ChainHeadRef | null
      lines: string[]
    }

export interface AcceptEntrySegmentParams {
  caseDir: string
  member: CaseMember
  fromIndex: number
  lines: string[]
}

export function nonEmptyLines(text: string): string[] {
  return text.split('\n').filter((line) => line.trim().length > 0)
}

// One page of chain lines under `maxBytes`: lines are taken in order until
// the next would cross the budget, and the first line always, so a page
// always carries something and a chain of any length is served in pages.
export function linesWithinBytes(lines: string[], maxBytes: number): string[] {
  const page: string[] = []
  let bytes = 0
  for (const line of lines) {
    const size = Buffer.byteLength(line, 'utf-8') + 1
    if (page.length > 0 && bytes + size > maxBytes) break
    page.push(line)
    bytes += size
  }
  return page
}

function headOf(lines: string[]): ChainHeadRef | null {
  const last = lines.at(-1)
  if (last === undefined) return null
  const { index, entryHash } = JSON.parse(last) as { index: number; entryHash: string }
  return { index, entryHash }
}

// The first entry of the chain's current segment that names another Case:
// the same rule the Shared Case walk applies (sharedCase.ts). Entries before
// the last `import` are a source Case's history and carry its id by design.
// Judged over a chain held whole (session.ts), never over one page: the
// `import` that makes a source Case's history legitimate may arrive on a
// later page, and a page judged alone would refuse that history at its
// first line.
export function foreignCaseEntry(
  entries: ManifestEntry[],
  caseId: string
): ManifestEntry | undefined {
  const lastImport = entries.reduce((at, e) => (e.type === 'import' ? e.index : at), 0)
  return entries.find((e) => e.index >= lastImport && e.caseId !== caseId)
}

export function acceptEntrySegment(params: AcceptEntrySegmentParams): EntryAcceptance {
  const { caseDir, member, fromIndex, lines } = params
  const stored = nonEmptyLines(readMemberChainText(caseDir, member.installationId))
  if (fromIndex !== stored.length) return { outcome: 'not-contiguous', storedCount: stored.length }
  // What the peer sent is split into chain lines first: the verifier reads
  // the segment by newline, so a wire line holding two entries or a blank
  // would otherwise be counted as one entry, and every count here and in
  // the session would drift from the file.
  const segment = lines.flatMap((line) => nonEmptyLines(line))
  if (segment.length === 0) {
    return { outcome: 'accepted', appended: 0, head: headOf(stored), lines: [] }
  }

  const candidate = [...stored, ...segment]
  const result = verifyManifestChainText(candidate.join('\n') + '\n', {
    publicKeyPem: member.publicKeyPem
  })

  // How much of the candidate verified: all of it, or everything before the
  // entry this build cannot read.
  let verifiedCount: number
  if (result.valid) {
    verifiedCount = candidate.length
  } else if (result.unsupported) {
    verifiedCount = result.unsupported.index
  } else {
    return {
      outcome: 'rejected',
      index: result.brokenAt ?? stored.length,
      reason: result.reason ?? 'chain did not verify'
    }
  }

  const verified = candidate.slice(0, verifiedCount)
  const toAppend = verified.slice(stored.length)
  appendMemberChainLines(caseDir, member.installationId, toAppend)
  const head = headOf(verified)
  if (result.unsupported) {
    return {
      outcome: 'newer-version',
      appended: toAppend.length,
      index: result.unsupported.index,
      reason: result.reason ?? 'entry from a newer schema',
      head,
      lines: toAppend
    }
  }
  return { outcome: 'accepted', appended: toAppend.length, head, lines: toAppend }
}
