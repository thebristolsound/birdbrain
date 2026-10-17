import { createHash, createSign, generateKeyPairSync } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getPublicKeyPem, signEntryHash } from '@main/services/signingKey'
import { canonicalStringify } from '@shared/verify'
import { packageHash } from '@shared/verify/packageHash'
import { memberChainPath } from '../../src/packages/evidence-package-layout/index'
import { buildSyntheticToken } from './timestampFixtures'

// The one evidence package carrying a receipt stamp (#1515, design decision
// 15), built for the in-process package verifier and for the built binary
// alike so the two are handed the same bytes, as helpers/egressPackage.ts
// does for the Egress fields. Written by hand: a two-member Shared Case as
// the Owner's replica holds it, the Owner's chain carrying both `member-add`
// entries, one document, a `merge` naming the member's head, and a receipt
// stamp over that `merge` with a synthetic token.
//
// The caller owns the signing key: it must already be initialised, as the
// node project's setup file does. The member's key is generated here.

export const RECEIPT_CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000001516'
export const RECEIPT_OWNER_ID = 'installation-owner-1515'
export const RECEIPT_MEMBER_ID = 'installation-member-1515'
export const RECEIPT_TSA = 'tsa.receipt.example'
export const RECEIPT_TIME = new Date('2026-10-17T11:00:00.000Z')

const OWNER = { operatorId: RECEIPT_OWNER_ID, operatorName: 'Casey Owner', toolVersion: '0.9.0' }
const MEMBER = {
  operatorId: RECEIPT_MEMBER_ID,
  operatorName: 'Robin Member',
  toolVersion: '0.9.0'
}
const TIME = '2026-10-17T10:00:00.000Z'

export interface ReceiptPackageOptions {
  // The receipt stamp's token attests another hash.
  wrongImprint?: boolean
  // The receipt stamp names a hash no `merge` in its chain has.
  namesNoMerge?: boolean
  // The member's chain carries a `merge` naming the Owner's document, and a
  // receipt stamp over it.
  memberReceipt?: boolean
  // No receipt stamp at all: the package every Shared Case export wrote
  // before #1515.
  withoutReceipt?: boolean
  // The receipt stamp's signature is rewritten, so the exporter's chain breaks
  // at that line.
  breakAtReceipt?: boolean
}

class Chain {
  lines: string[] = []
  hashes: string[] = []
  constructor(private sign: (entryHash: string) => string) {}
  append(body: Record<string, unknown>, signature?: string): string {
    const full = { ...body, index: this.lines.length, prevHash: this.hashes.at(-1) ?? '' }
    const entryHash = createHash('sha256').update(canonicalStringify(full)).digest('hex')
    this.lines.push(
      JSON.stringify({ ...full, entryHash, signature: signature ?? this.sign(entryHash) })
    )
    this.hashes.push(entryHash)
    return entryHash
  }
  get head(): { index: number; entryHash: string } {
    const index = this.lines.length - 1
    return { index, entryHash: this.hashes[index] }
  }
  get jsonl(): string {
    return this.lines.join('\n') + '\n'
  }
}

interface Document {
  exhibitId: string
  name: string
  path: string
  bytes: Buffer
  contentHash: string
}

function document(by: typeof OWNER, n: number): Document {
  const exhibitId = `${by.operatorId}-doc-${n}`
  const bytes = Buffer.from(`%PDF statement ${n} by ${by.operatorName}`)
  return {
    exhibitId,
    name: `statement-${n}.pdf`,
    path: `${RECEIPT_CASE_ID}/documents/${exhibitId}.pdf`,
    bytes,
    contentHash: createHash('sha256').update(bytes).digest('hex')
  }
}

const exhibitEntry = (doc: Document, by: typeof OWNER, memberCode?: string) => ({
  type: 'exhibit',
  exhibitId: doc.exhibitId,
  caseId: RECEIPT_CASE_ID,
  kind: 'document',
  origin: 'manual-upload',
  name: doc.name,
  exhibitNumber: 1,
  path: doc.path,
  contentHash: doc.contentHash,
  sizeBytes: doc.bytes.length,
  timestamp: TIME,
  ...by,
  ...(memberCode === undefined ? { schemaVersion: 3 } : { memberCode, schemaVersion: 4 })
})

const memberAdd = (
  installationId: string,
  pem: string,
  code: string,
  by: typeof OWNER,
  role: 'owner' | 'member'
) => ({
  type: 'member-add',
  caseId: RECEIPT_CASE_ID,
  memberInstallationId: installationId,
  memberPublicKeyPem: pem,
  memberCode: code,
  memberOperatorName: by.operatorName,
  nodeId: `node-${installationId}`,
  role,
  timestamp: TIME,
  ...OWNER,
  schemaVersion: 4
})

const mergeEntry = (
  installationId: string,
  head: { index: number; entryHash: string },
  by: typeof OWNER
) => ({
  type: 'merge',
  caseId: RECEIPT_CASE_ID,
  heads: [{ installationId, ...head, entriesReceived: head.index + 1 }],
  timestamp: TIME,
  ...by,
  schemaVersion: 4
})

const receiptEntry = (entryHash: string, imprint: string, by: typeof OWNER) => ({
  type: 'timestamp',
  caseId: RECEIPT_CASE_ID,
  captureContentHash: entryHash,
  subject: 'entry',
  timestamp: TIME,
  tsaToken: buildSyntheticToken({
    contentHash: imprint,
    genTime: RECEIPT_TIME,
    tsaDnsName: RECEIPT_TSA
  }).toString('base64'),
  ...by,
  schemaVersion: 4
})

export interface ReceiptPackage {
  // Index of the Owner's `merge` in the Owner's chain.
  mergeIndex: number
  // Index of the member's `merge` in the member's chain, when written.
  memberMergeIndex?: number
  // Index of the Owner's receipt stamp, when written.
  receiptIndex?: number
}

/**
 * Writes the package into `dir` and returns where its `merge` and receipt
 * entries sit.
 */
export function writeReceiptPackage(
  dir: string,
  options: ReceiptPackageOptions = {}
): ReceiptPackage {
  const memberKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  const member = new Chain((entryHash) =>
    createSign('sha256').update(entryHash).sign(memberKey.privateKey, 'base64')
  )
  const owner = new Chain(signEntryHash)

  const ownerDoc = document(OWNER, 1)
  const memberDoc = document(MEMBER, 1)
  owner.append(memberAdd(RECEIPT_OWNER_ID, getPublicKeyPem(), 'CO', OWNER, 'owner'))
  owner.append(memberAdd(RECEIPT_MEMBER_ID, memberKey.publicKey, 'RM', MEMBER, 'member'))
  owner.append(exhibitEntry(ownerDoc, OWNER))
  member.append(exhibitEntry(memberDoc, MEMBER, 'RM'))

  const result: ReceiptPackage = { mergeIndex: -1 }
  if (options.memberReceipt) {
    const hash = member.append(mergeEntry(RECEIPT_OWNER_ID, owner.head, MEMBER))
    result.memberMergeIndex = member.head.index
    member.append(receiptEntry(hash, hash, MEMBER))
  }

  const mergeHash = owner.append(mergeEntry(RECEIPT_MEMBER_ID, member.head, OWNER))
  result.mergeIndex = owner.head.index
  if (!options.withoutReceipt) {
    const named = options.namesNoMerge ? 'b'.repeat(64) : mergeHash
    const imprint = options.wrongImprint ? 'c'.repeat(64) : named
    owner.append(
      receiptEntry(named, imprint, OWNER),
      options.breakAtReceipt ? signEntryHash('d'.repeat(64)) : undefined
    )
    result.receiptIndex = owner.head.index
  }

  const exportBody = {
    type: 'export',
    caseId: RECEIPT_CASE_ID,
    timestamp: '2026-10-17T12:00:00.000Z',
    ...OWNER,
    packageHash: packageHash([]),
    verificationResult: {
      overallValid: true,
      captureCount: 0,
      verifiedCount: 0,
      tamperedCount: 0,
      missingCount: 0
    },
    schemaVersion: 2
  }
  const head = owner.head
  owner.append(exportBody)
  const exportLine = owner.lines.pop()!
  owner.hashes.pop()

  writeFileSync(join(dir, 'manifest.jsonl'), owner.jsonl, 'utf-8')
  writeFileSync(join(dir, memberChainPath(RECEIPT_MEMBER_ID)), member.jsonl, 'utf-8')
  writeFileSync(join(dir, 'export-entry.json'), exportLine, 'utf-8')
  writeFileSync(join(dir, 'signing-public-key.pem'), getPublicKeyPem(), 'utf-8')
  const rows = [ownerDoc, memberDoc].map((doc) => {
    const path = doc.path.slice(RECEIPT_CASE_ID.length + 1)
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), doc.bytes)
    return {
      id: doc.exhibitId,
      kind: 'document',
      origin: 'manual-upload',
      exhibitNumber: 1,
      name: doc.name,
      contentHash: doc.contentHash,
      path,
      derivedFiles: []
    }
  })
  writeFileSync(
    join(dir, 'evidence.json'),
    JSON.stringify({
      schemaVersion: 2,
      verificationMaterials: {
        manifestPath: 'manifest.jsonl',
        manifestHeadIndex: head.index,
        manifestHeadHash: head.entryHash,
        signingPublicKeyPath: 'signing-public-key.pem'
      },
      captures: [],
      exhibits: rows,
      artifacts: []
    }),
    'utf-8'
  )
  return result
}
