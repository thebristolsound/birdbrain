import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import {
  initDatabase,
  closeDatabase,
  createCase
} from '../../../src/main/services/database'
import { initStorage, ensureCaseDir } from '../../../src/main/services/storage'
import { appendManifestEntry, initManifest } from '../../../src/main/services/manifest'
import { ingestMhtmlCapture } from '../../../src/main/services/captureLifecycle'
import {
  createCaptureLifecycle,
  type CaptureLifecycle
} from '../../../src/main/services/captureLifecycle'
import { createSelectorLifecycle } from '../../../src/main/services/selectorLifecycle'
import { generateReport } from '../../../src/main/services/export'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { HAS_OPENSSL } from '../../helpers/openssl'
import type { ExportOptions } from '../../../src/shared/types'

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

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-export-tsverify-'))
    initStorage(join(tempDir, 'captures'))
    initDatabase(':memory:')
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
    'openssl verifies the exported .tst against the exported tsa-ca-chain.pem',
    async () => {
      // The capture content hash must match the imprint inside the DigiCert token,
      // otherwise openssl would still pass (it checks the token, not our capture),
      // but the manifest binds this token to this capture as the export does.
      const { capture } = await ingest(caseId, '<html><body>Packaged evidence</body></html>')
      const token = readFileSync(join(FIXTURES, 'digicert-token.der'))
      appendManifestEntry(join(tempDir, 'captures', caseId), {
        type: 'timestamp',
        caseId,
        captureContentHash: capture.hash,
        timestamp: '2026-04-05T12:01:00.000Z',
        tsaToken: token.toString('base64'),
        operatorId: 'op',
        operatorName: 'Test Operator',
        toolVersion: '0.1.0'
      })

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
      const chain = entries.get('tsa-ca-chain.pem')
      expect(tst).toBeDefined()
      expect(chain).toBeDefined()

      // Extract the shipped artifacts to disk for openssl.
      const dir = mkdtempSync(join(tmpdir(), 'bb-bundle-'))
      const tstPath = join(dir, 'capture.tst')
      const chainPath = join(dir, 'tsa-ca-chain.pem')
      writeFileSync(tstPath, tst!)
      writeFileSync(chainPath, chain!)

      try {
        // Court verification: the shipped chain carries the responder/intermediate
        // certs as -untrusted candidates; the self-signed DigiCert Trusted Root G4
        // (committed fixture) is the trust anchor via -CAfile. The token also embeds
        // its own intermediates, so this proves the bundle is self-sufficient.
        const out = execFileSync(
          'openssl',
          [
            'ts',
            '-verify',
            '-token_in',
            '-in',
            tstPath,
            '-queryfile',
            join(FIXTURES, 'request.tsq'),
            '-untrusted',
            chainPath,
            '-CAfile',
            join(FIXTURES, 'digicert-trusted-root-g4.pem')
          ],
          { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
        )
        expect(out).toContain('Verification: OK')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  )
})
