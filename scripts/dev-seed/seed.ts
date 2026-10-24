/**
 * Fills a prepared throwaway profile (see `profile.mjs`) with the data `pnpm dev:seed` opens on:
 * an ordinary Case and a Shared Case with a second member, a revoked third member and one
 * excluded Exhibit (#1514). Main-process code, run through the app's own
 * modules: `launch.mjs` bundles it and runs it under Electron, and `tests/devSeed.test.ts` runs
 * it in the unit suite.
 *
 * Every page, host, person and installation here is invented. Hosts sit on the reserved example
 * domains (RFC 2606).
 */

import { createHash, createSign, generateKeyPairSync, randomUUID } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { deflateSync, crc32 } from 'zlib'
import { dirname, join } from 'path'
import { closeDatabase, getDb, initDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertExhibit } from '@main/services/db/exhibitRepo'
import { upsertCaseMember } from '@main/services/db/caseMemberRepo'
import { createNote } from '@main/services/db/noteRepo'
import { createSelector, matchSelectorAgainstCaptures } from '@main/services/db/selectorRepo'
import { addTagToCapture, createTag } from '@main/services/db/tagRepo'
import { getSettings, initSettings } from '@main/services/settings'
import { getInstallationId, initInstallationId } from '@main/services/installationId'
import { getPublicKeyPem, initSigningKey, signEntryHash } from '@main/services/signingKey'
import { ensureCaseDir, getStorageRoot, initStorage } from '@main/services/storage'
import { ingestMhtmlCapture } from '@main/services/captureLifecycle'
import { resolveToolVersion } from '@main/services/toolVersion'
import { canonicalStringify } from '@shared/verify'
import { memberChainPath } from '../../src/packages/evidence-package-layout/index'
import {
  EXCLUDE_REASON,
  MEMBER_MEMBER_CODE,
  ORDINARY_CASE_NAME,
  OWNER_MEMBER_CODE,
  REVOKED_MEMBER_CODE,
  REVOKED_MEMBER_NAME,
  SELECTOR_PATTERN,
  SHARED_CASE_NAME
} from './constants'

export interface SeededProfile {
  caseId: string
  sharedCaseId: string
  memberInstallationId: string
  revokedInstallationId: string
}

interface Operator {
  operatorId: string
  operatorName: string
  toolVersion: string
}

interface SeedPage {
  url: string
  title: string
  text: string
  screenshot: boolean
}

const PAGES: SeedPage[] = [
  {
    url: 'https://harbour-lane.example.com/accounts/deposit',
    title: 'Harbour Lane Savings - Make a deposit',
    text:
      'Harbour Lane Savings. Make a deposit. Send funds to reference HL-2291-7734 before ' +
      'Friday to secure the bonus rate.',
    screenshot: true
  },
  {
    url: 'https://forum.example.org/threads/harbour-lane-bonus',
    title: 'Is the Harbour Lane bonus rate real? - Example Forum',
    text:
      'Is the Harbour Lane bonus rate real? Three members report deposits to HL-2291-7734 ' +
      'that were never credited.',
    screenshot: false
  },
  {
    url: 'https://registry.example.net/companies/harbour-lane-savings',
    title: 'Harbour Lane Savings Ltd - Example Company Registry',
    text: 'Harbour Lane Savings Ltd. Status: dissolved. No registered office.',
    screenshot: false
  }
]

function htmlPage({ title, text }: SeedPage): string {
  const head = `<head><meta charset="utf-8"><title>${title}</title></head>`
  return `<!doctype html><html>${head}<body><h1>${title}</h1><p>${text}</p></body></html>`
}

// One text/html part in the flat multipart/related shape Chrome saves.
function mhtml(page: SeedPage, timestamp: string): Buffer {
  const boundary = '----MultipartBoundary--birdbrainDevSeed----'
  return Buffer.from(
    [
      'From: <Saved by Blink>',
      `Snapshot-Content-Location: ${page.url}`,
      `Subject: ${page.title}`,
      `Date: ${new Date(timestamp).toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: multipart/related;',
      '\ttype="text/html";',
      `\tboundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-ID: <frame-0@mhtml.blink>',
      'Content-Transfer-Encoding: 8bit',
      `Content-Location: ${page.url}`,
      '',
      htmlPage(page),
      `--${boundary}--`,
      ''
    ].join('\r\n'),
    'utf-8'
  )
}

// A greyscale PNG shaped like a page: a dark header band over grey lines of "text".
function screenshotPng(width = 1280, height = 800): Buffer {
  const stride = width + 1
  const raw = Buffer.alloc(stride * height, 0xff)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0
    const isLine = y > 120 && (y - 120) % 36 < 14
    for (let x = 0; x < width; x++) {
      if (y < 72) raw[y * stride + 1 + x] = 0x24
      else if (isLine && x > 80 && x < width - 240) raw[y * stride + 1 + x] = 0xd4
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function bufferStream(buf: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buf))
      controller.close()
    }
  })
}

async function seedOrdinaryCase(who: Operator): Promise<string> {
  const { id: caseId } = createCase({
    name: ORDINARY_CASE_NAME,
    description: 'Seeded by pnpm dev:seed. Every page in it is invented.',
    type: 'fraud'
  })
  const captures: Array<{ id: string; text: string }> = []
  for (const [i, page] of PAGES.entries()) {
    const timestamp = new Date(Date.now() - (PAGES.length - i) * 60_000).toISOString()
    const { capture } = await ingestMhtmlCapture(
      {
        caseId,
        url: page.url,
        title: page.title,
        timestamp,
        stream: bufferStream(mhtml(page, timestamp)),
        textContent: page.text,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        browserVersion: 'Chrome/120.0.0.0',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
        httpStatus: 200,
        ...(page.screenshot ? { screenshot: screenshotPng() } : {}),
        ...who
      },
      // Invented hosts have no certificate to re-fetch; null records "not corroborated".
      async () => null
    )
    captures.push({ id: capture.id, text: page.text })
  }

  const selector = createSelector({ caseId, pattern: SELECTOR_PATTERN, label: 'Deposit reference' })
  matchSelectorAgainstCaptures(
    selector.id,
    captures.map(({ id, text }) => ({ captureId: id, text }))
  )

  const suspect = createTag({ name: 'suspect-site', color: '#c2410c' })
  createTag({ name: 'follow-up', color: '#2563eb' })
  addTagToCapture({ captureId: captures[0].id, tagId: suspect.id })

  createNote({
    caseId,
    captureId: captures[0].id,
    anchor: JSON.stringify({ kind: 'capture', captureId: captures[0].id }),
    title: 'Deposit page',
    body: 'The deposit page names the same reference the forum thread complains about.'
  })
  createNote({
    caseId,
    title: 'Next steps',
    body: 'Ask the registry for the dissolution filing.'
  })
  return caseId
}

// A signed chain built line by line, as appendManifestEntry builds one. The app has no writer for
// `member-add` yet (#1810), so the entries are signed here, the way
// tests/main/services/sharedCaseExport.test.ts signs them.
class Chain {
  lines: string[] = []
  hashes: string[] = []
  entries: Record<string, unknown>[] = []
  constructor(private sign: (entryHash: string) => string) {}
  append(body: Record<string, unknown>): number {
    const index = this.lines.length
    const full = { ...body, index, prevHash: this.hashes.at(-1) ?? '' }
    const entryHash = createHash('sha256').update(canonicalStringify(full)).digest('hex')
    this.lines.push(JSON.stringify({ ...full, entryHash, signature: this.sign(entryHash) }))
    this.hashes.push(entryHash)
    this.entries.push(full)
    return index
  }
  get jsonl(): string {
    return this.lines.join('\n') + '\n'
  }
}

interface SharedDocument {
  exhibitId: string
  path: string
  name: string
  contentHash: string
  sizeBytes: number
  index: number
}

// One committed text document: its bytes on disk and the `exhibit` entry its author signed.
function commitDocument(
  chain: Chain,
  caseId: string,
  who: Operator,
  name: string,
  text: string,
  timestamp: string
): SharedDocument {
  const exhibitId = randomUUID()
  const path = `${caseId}/documents/${exhibitId}.txt`
  const bytes = Buffer.from(text, 'utf-8')
  const contentHash = createHash('sha256').update(bytes).digest('hex')
  const abs = join(getStorageRoot(), path)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, bytes)
  const index = chain.append({
    type: 'exhibit',
    exhibitId,
    caseId,
    kind: 'document',
    origin: 'manual-upload',
    name,
    exhibitNumber: 1,
    path,
    contentHash,
    sizeBytes: bytes.length,
    timestamp,
    ...who,
    schemaVersion: 3
  })
  return { exhibitId, path, name, contentHash, sizeBytes: bytes.length, index }
}

const newMemberKey = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })

function seedSharedCase(owner: Operator): Omit<SeededProfile, 'caseId'> {
  const timestamp = new Date().toISOString()
  const { id: caseId } = createCase({
    name: SHARED_CASE_NAME,
    description:
      'Seeded by pnpm dev:seed: a Shared Case with two invented members, one of them revoked.'
  })
  const caseDir = ensureCaseDir(caseId)

  const memberKey = newMemberKey()
  const memberId = randomUUID()
  // The revoked member has a key and a roster row but no chain file: the Owner merged nothing
  // from it before revoking it, which the Shared Case walk accepts without a finding.
  const revokedKey = newMemberKey()
  const revokedId = randomUUID()
  const member: Operator = {
    operatorId: memberId,
    operatorName: 'Morgan Reyes',
    toolVersion: owner.toolVersion
  }

  const memberChain = new Chain((hash) =>
    createSign('sha256').update(hash).sign(memberKey.privateKey, 'base64')
  )
  const memberDoc = commitDocument(
    memberChain,
    caseId,
    member,
    'bank-letter.txt',
    'Northgate Bank letter, invented for the dev seed: account 0000 closed on request.',
    timestamp
  )

  const ownerChain = new Chain(signEntryHash)
  const memberAdd = (
    installationId: string,
    publicKeyPem: string,
    memberCode: string,
    operatorName: string,
    role: 'owner' | 'member'
  ): number =>
    ownerChain.append({
      type: 'member-add',
      caseId,
      memberInstallationId: installationId,
      memberPublicKeyPem: publicKeyPem,
      memberCode,
      memberOperatorName: operatorName,
      nodeId: `node-${installationId}`,
      role,
      timestamp,
      ...owner,
      schemaVersion: 4
    })
  memberAdd(owner.operatorId, getPublicKeyPem(), OWNER_MEMBER_CODE, owner.operatorName, 'owner')
  memberAdd(memberId, memberKey.publicKey, MEMBER_MEMBER_CODE, member.operatorName, 'member')
  memberAdd(revokedId, revokedKey.publicKey, REVOKED_MEMBER_CODE, REVOKED_MEMBER_NAME, 'member')
  const ownerDoc = commitDocument(
    ownerChain,
    caseId,
    owner,
    'witness-statement.txt',
    'Witness statement, invented for the dev seed: the deposit was sent on the Friday.',
    timestamp
  )
  ownerChain.append({
    type: 'merge',
    caseId,
    heads: [
      {
        installationId: memberId,
        index: memberChain.lines.length - 1,
        entryHash: memberChain.hashes.at(-1),
        entriesReceived: memberChain.lines.length
      }
    ],
    timestamp,
    ...owner,
    schemaVersion: 4
  })
  // The Owner excludes the member's Exhibit from exports, then revokes the third member. Both
  // entries follow the merge: an `exclude` names an Exhibit the Owner has received, and the
  // revocation is the chain's last word on that member.
  ownerChain.append({
    type: 'exclude',
    caseId,
    exhibitId: memberDoc.exhibitId,
    authorInstallationId: memberId,
    reason: EXCLUDE_REASON,
    timestamp,
    ...owner,
    schemaVersion: 4
  })
  const revokedAtIndex = ownerChain.append({
    type: 'member-revoke',
    caseId,
    memberInstallationId: revokedId,
    timestamp,
    ...owner,
    schemaVersion: 4
  })
  writeFileSync(join(caseDir, 'manifest.jsonl'), ownerChain.jsonl)
  writeFileSync(join(caseDir, memberChainPath(memberId)), memberChain.jsonl)

  // The roster is a cache of the `member-add` entries, so it is written from them; the revoked
  // row carries the `member-revoke` entry's index.
  for (const entry of ownerChain.entries.filter((e) => e.type === 'member-add')) {
    const installationId = entry.memberInstallationId as string
    upsertCaseMember({
      caseId,
      installationId,
      publicKeyPem: entry.memberPublicKeyPem as string,
      memberCode: entry.memberCode as string,
      operatorName: entry.memberOperatorName as string,
      nodeId: entry.nodeId as string,
      role: entry.role as 'owner' | 'member',
      addedAtIndex: entry.index as number,
      revokedAtIndex: installationId === revokedId ? revokedAtIndex : null
    })
  }

  insertExhibit({
    id: ownerDoc.exhibitId,
    caseId,
    kind: 'document',
    origin: 'manual-upload',
    name: ownerDoc.name,
    contentHash: ownerDoc.contentHash,
    path: ownerDoc.path,
    sizeBytes: ownerDoc.sizeBytes,
    committedAt: timestamp,
    manifestSeq: ownerDoc.index,
    exhibitNumber: 1
  })
  // Raw SQL: no repo writes a remote member's row or marks a Case shared until sync lands (#1810),
  // and adding one would change src/main/services/db/, a blocking-tier evidence path.
  const db = getDb()
  db.prepare(
    `INSERT INTO exhibits (
       id, case_id, kind, origin, exhibit_number, name, content_hash, path,
       size_bytes, committed_at, manifest_seq, member_code, author_installation_id
     ) VALUES (?, ?, 'document', 'manual-upload', 1, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    memberDoc.exhibitId,
    caseId,
    memberDoc.name,
    memberDoc.contentHash,
    memberDoc.path,
    memberDoc.sizeBytes,
    timestamp,
    memberDoc.index,
    MEMBER_MEMBER_CODE,
    memberId
  )
  db.prepare('UPDATE cases SET shared_at = ?, owner_installation_id = ? WHERE id = ?').run(
    timestamp,
    owner.operatorId,
    caseId
  )
  return { sharedCaseId: caseId, memberInstallationId: memberId, revokedInstallationId: revokedId }
}

/** Seeds `userData`, which `prepareProfile` has already prepared, and closes the database. */
export async function seedProfile(userData: string): Promise<SeededProfile> {
  await initDatabase(join(userData, 'birdbrain.db'))
  try {
    initSettings(userData)
    initInstallationId(userData)
    // prepareProfile wrote a plaintext key, so this reads it; the options only keep a profile
    // without one from waiting on a dialog nobody can answer.
    initSigningKey(userData, {
      isEncryptionAvailable: () => false,
      confirmUnprotectedKey: () => true
    })
    initStorage(join(userData, 'captures'))
    const who: Operator = {
      operatorId: getInstallationId(),
      operatorName: getSettings().operatorName ?? '',
      toolVersion: resolveToolVersion()
    }
    // The ordinary Case goes in last: with any Case present the app reopens the most recently
    // updated one (resolveStartRoute in useSessionRestore.ts), and that should be the one with
    // Captures to show.
    const shared = seedSharedCase(who)
    const caseId = await seedOrdinaryCase(who)
    return { caseId, ...shared }
  } finally {
    closeDatabase()
  }
}
