import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  appendManifestEntry,
  ensureMemberChainFile,
  initManifest,
  readManifestSnapshot,
  readMemberChainText,
  type ManifestEntryInput
} from '@main/services/manifest'
import { getPublicKeyPem } from '@main/services/signingKey'
import { ManifestEntrySchema } from '@shared/schemas'
import { MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import { verifyManifestChainText } from '@shared/verify'
import { memberChainPath } from '../../../../src/packages/evidence-package-layout/index'

// The stamps of the entries #1810 writes: every roster entry stamps 4, the
// version the 1.0.1-beta.22 verifier reads, and an `exhibit` entry stamps 4
// only when it carries `memberCode`. The pin is "at most 4" for each, not
// `MANIFEST_SCHEMA_VERSION`, so a later ceiling bump does not move it.

const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000010'
const TIME = '2026-10-02T09:00:00.000Z'
const BY = { operatorId: 'installation-owner', operatorName: 'Alice Owner', toolVersion: '0.0.0' }
const MEMBER_ID = 'installation-member'

describe('manifest stamps for the roster entries (#1810)', () => {
  let caseDir: string

  beforeEach(() => {
    caseDir = mkdtempSync(join(tmpdir(), 'bb-manifest-stamps-'))
    initManifest(caseDir)
  })

  afterEach(() => {
    rmSync(caseDir, { recursive: true, force: true })
  })

  const lastLine = (): Record<string, unknown> => {
    const { entries } = readManifestSnapshot(caseDir)
    return entries.at(-1)!
  }

  const append = (entry: ManifestEntryInput): Record<string, unknown> => {
    appendManifestEntry(caseDir, entry)
    const line = lastLine()
    expect(ManifestEntrySchema.safeParse(line).success).toBe(true)
    return line
  }

  it('stamps member-add, member-revoke and exclude at 4', () => {
    expect(MANIFEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(4)
    const added = append({
      type: 'member-add',
      caseId: CASE_ID,
      memberInstallationId: BY.operatorId,
      memberPublicKeyPem: getPublicKeyPem(),
      memberCode: 'AL',
      memberOperatorName: 'Alice Owner',
      nodeId: 'node-alice',
      role: 'owner',
      timestamp: TIME,
      ...BY
    })
    expect(added.schemaVersion).toBe(4)
    const revoked = append({
      type: 'member-revoke',
      caseId: CASE_ID,
      memberInstallationId: MEMBER_ID,
      timestamp: TIME,
      ...BY
    })
    expect(revoked.schemaVersion).toBe(4)
    const excluded = append({
      type: 'exclude',
      caseId: CASE_ID,
      exhibitId: 'exhibit-1',
      authorInstallationId: MEMBER_ID,
      reason: 'duplicate',
      timestamp: TIME,
      ...BY
    })
    expect(excluded.schemaVersion).toBe(4)
    expect(excluded.reason).toBe('duplicate')
    const bare = append({
      type: 'exclude',
      caseId: CASE_ID,
      exhibitId: 'exhibit-2',
      authorInstallationId: MEMBER_ID,
      timestamp: TIME,
      ...BY
    })
    expect('reason' in bare).toBe(false)
    const chain = verifyManifestChainText(readManifestSnapshot(caseDir).jsonl.toString('utf-8'), {
      publicKeyPem: getPublicKeyPem()
    })
    expect(chain.valid).toBe(true)
  })

  it('stamps an exhibit entry 4 only when it carries memberCode, and 3 otherwise', () => {
    const exhibit = (n: number, memberCode?: string): ManifestEntryInput => ({
      type: 'exhibit',
      exhibitId: `exhibit-${n}`,
      caseId: CASE_ID,
      kind: 'document',
      origin: 'manual-upload',
      name: `statement-${n}.pdf`,
      exhibitNumber: n,
      path: `${CASE_ID}/documents/exhibit-${n}.pdf`,
      contentHash: 'a'.repeat(64),
      sizeBytes: 10,
      ...(memberCode === undefined ? {} : { memberCode }),
      timestamp: TIME,
      ...BY
    })
    const plain = append(exhibit(1))
    expect(plain.schemaVersion).toBe(3)
    expect('memberCode' in plain).toBe(false)
    const coded = append(exhibit(2, 'AL'))
    expect(coded.schemaVersion).toBe(4)
    expect(coded.memberCode).toBe('AL')
  })

  it('creates an empty member chain file once, which verifies with no entries and no head', () => {
    const path = join(caseDir, memberChainPath(MEMBER_ID))
    expect(existsSync(path)).toBe(false)
    ensureMemberChainFile(caseDir, MEMBER_ID)
    expect(statSync(path).size).toBe(0)
    expect(readMemberChainText(caseDir, MEMBER_ID)).toBe('')
    const empty = verifyManifestChainText('', { publicKeyPem: getPublicKeyPem() })
    expect(empty.valid).toBe(true)
    // A second call leaves a file that has since gained a line untouched.
    writeFileSync(path, '{"index":0}\n')
    ensureMemberChainFile(caseDir, MEMBER_ID)
    expect(readFileSync(path, 'utf-8')).toBe('{"index":0}\n')
  })

  it('refuses to name a chain file after an id that is not one path segment', () => {
    expect(() => ensureMemberChainFile(caseDir, '../escape')).toThrow(/cannot name a chain file/)
    expect(existsSync(join(caseDir, '..', 'manifest.escape.jsonl'))).toBe(false)
  })
})
