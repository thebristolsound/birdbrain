import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { appendManifestEntry, initManifest } from '@main/services/manifest'
import { ingestMhtmlCapture } from '@main/services/captureLifecycle'
import {
  createCaptureLifecycle,
  type CaptureLifecycle
} from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { generateReport } from '@main/services/export'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { HAS_OPENSSL } from '../../helpers/openssl'
import { DIGICERT_TRUSTED_ROOT_G4_SHA256 } from '@main/services/tsaTrust'
import type { ExportOptions } from '@shared/types'

const FIXTURES = join(process.cwd(), 'tests/fixtures/timestamp')

// Read stored (uncompressed) ZIP local-file entries — same minimal reader the
// sibling export test uses, kept self-contained here.
function readStoredZipEntries(path: string): Map<string, Buffer> {
  const zip = readFileSync(path)
  const entries = new Map<string, Buffer>()
  let offset = 0

  while (offset < zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8)
    const compressedSize = zip.readUInt32LE(offset + 18)
    const nameLength = zip.readUInt16LE(offset + 26)
    const extraLength = zip.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = zip.subarray(nameStart, nameStart + nameLength).toString('utf-8')

    if (method !== 0) throw new Error(`Unexpected compressed ZIP entry in test: ${name}`)

    entries.set(name, zip.subarray(dataStart, dataStart + compressedSize))
    offset = dataStart + compressedSize
  }

  return entries
}

async function ingest(caseId: string, payload: string) {
  const stream = Readable.from([Buffer.from(payload)])
  return ingestMhtmlCapture({
    caseId,
    url: 'https://example.com/evidence',
    title: 'Evidence Page',
    timestamp: '2026-04-05T12:00:00.000Z',
    stream: stream as unknown as ReadableStream<Uint8Array>,
    textContent: payload,
    headers: {},
    browserVersion: '',
    userAgent: '',
    httpStatus: 200,
    extensionVersion: '',
    operatorId: 'op',
    operatorName: '',
    toolVersion: '0.1.0'
  })
}

// G2 (epic #146): prove the SHIPPED evidence bundle — not just the raw fixture —
// chains to the DigiCert trust anchor under `openssl ts -verify`. The export
// path is seeded with the REAL DigiCert token so the produced `timestamps/<id>.tst`
// and `tsa-ca-chain.pem` are cryptographically genuine.
describe('exported evidence bundle verifies under openssl ts -verify', () => {
  let tempDir: string
  let caseId: string
  let captureLifecycle: CaptureLifecycle

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-export-tsverify-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator', operatorRole: '', operatorOrganization: '' })

    const c = createCase({ name: 'TS Verify Case', description: 'Export TSA verify' })
    caseId = c.id
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'captures', caseId))
    const selectorLifecycle = createSelectorLifecycle({ emitRematched: () => {} })
    captureLifecycle = createCaptureLifecycle({ selectorLifecycle })
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it.skipIf(!HAS_OPENSSL)(
    'openssl verifies the exported .tst with exactly the command VERIFY.md documents',
    async () => {
      // The fixture token stamps the digest in content-hash.txt, not this
      // capture's bytes; the manifest still binds it to the capture the way the
      // export does, and `-digest` below is fed the token's real imprint so the
      // documented command is exercised end to end (imprint check included).
      const { capture } = await ingest(caseId, '<html><body>Packaged evidence</body></html>')
      const token = readFileSync(join(FIXTURES, 'digicert-token.der'))
      const imprint = readFileSync(join(FIXTURES, 'content-hash.txt'), 'utf-8').trim()
      // Two timestamp entries for one token: the intermediates file must still
      // carry each certificate once (#579).
      for (const timestamp of ['2026-04-05T12:01:00.000Z', '2026-04-05T12:02:00.000Z']) {
        appendManifestEntry(join(tempDir, 'captures', caseId), {
          type: 'timestamp',
          caseId,
          captureContentHash: capture.hash,
          timestamp,
          tsaToken: token.toString('base64'),
          operatorId: 'op',
          operatorName: 'Test Operator',
          toolVersion: '0.1.0'
        })
      }

      const outputPath = join(tempDir, 'evidence.zip')
      const options: ExportOptions = {
        format: 'zip',
        include: { captures: true, screenshots: false, auditTrail: true, annotations: 'none' },
        investigatorName: 'Test User',
        outputPath
      }
      await generateReport(caseId, options, captureLifecycle)

      const entries = readStoredZipEntries(outputPath)
      const tst = entries.get(`timestamps/${capture.id}.tst`)
      const root = entries.get('tsa-root.pem')
      const intermediates = entries.get('tsa-intermediates.pem')
      const runbook = entries.get('VERIFY.md')?.toString('utf-8') ?? ''
      expect(tst).toBeDefined()
      expect(root).toBeDefined()
      expect(intermediates).toBeDefined()

      const certBlocks = (pem: Buffer) => pem.toString('utf-8').match(/BEGIN CERTIFICATE/g) ?? []
      expect(certBlocks(root!)).toHaveLength(1)
      const embedded = readFileSync(join(FIXTURES, 'embedded-chain.pem'))
      expect(certBlocks(intermediates!)).toHaveLength(certBlocks(embedded).length)

      // Extract the shipped artifacts to disk for openssl.
      const dir = mkdtempSync(join(tmpdir(), 'bb-bundle-'))
      writeFileSync(join(dir, 'tsa-root.pem'), root!)
      writeFileSync(join(dir, 'tsa-intermediates.pem'), intermediates!)
      mkdirSync(join(dir, 'timestamps'))
      writeFileSync(join(dir, 'timestamps', `${capture.id}.tst`), tst!)

      try {
        // Lift the step-6 command out of the shipped runbook rather than
        // restating it, so a runbook that cannot be executed as written (#578)
        // fails here instead of in front of a third party.
        const documented = runbook.match(/^openssl ts -verify [^\n]*\\\n[^\n]*$/m)?.[0]
        expect(documented).toBeDefined()
        const argv = documented!
          .replace(/\\\n/g, ' ')
          .split(/\s+/)
          .slice(1)
          .map((arg) =>
            arg
              .replace('<contentHash>', imprint)
              .replace('<token>', capture.id)
          )
        expect(argv).toContain('-token_in')
        expect(argv).toEqual(expect.arrayContaining(['-CAfile', 'tsa-root.pem']))
        expect(argv).toEqual(expect.arrayContaining(['-untrusted', 'tsa-intermediates.pem']))
        const out = execFileSync('openssl', argv, {
          cwd: dir,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe']
        })
        expect(out).toContain('Verification: OK')

        // The step-6a anchor check, also as documented.
        const fp = execFileSync(
          'openssl',
          ['x509', '-in', 'tsa-root.pem', '-noout', '-subject', '-issuer', '-fingerprint', '-sha256'],
          { cwd: dir, encoding: 'utf-8' }
        )
        const [subject, issuer, fingerprint] = fp.trim().split('\n')
        expect(subject.replace(/^subject=/, '')).toBe(issuer.replace(/^issuer=/, ''))
        expect(fingerprint).toContain(DIGICERT_TRUSTED_ROOT_G4_SHA256)
        expect(runbook).toContain(DIGICERT_TRUSTED_ROOT_G4_SHA256)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  )
})
