import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { createHash } from 'crypto'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { appendManifestEntry, initManifest } from '@main/services/manifest'
import {
  ingestMhtmlCapture,
  createCaptureLifecycle,
  type CaptureLifecycle
} from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { generateReport } from '@main/services/export'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { buildSyntheticToken } from '../../helpers/timestampFixtures'
import type { ExportOptions } from '@shared/types'

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

async function ingest(caseId: string, payload: string, url: string, title: string) {
  const stream = Readable.from([Buffer.from(payload)])
  return ingestMhtmlCapture({
    caseId,
    url,
    title,
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

const ZIP_OPTIONS: ExportOptions = {
  format: 'zip',
  include: { captures: true, screenshots: false, auditTrail: true, annotations: 'none' },
  investigatorName: 'Test User',
  outputPath: ''
}

describe('certification', () => {
  let tempDir: string
  let caseId: string
  let captureLifecycle: CaptureLifecycle

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-cert-'))
    initStorage(join(tempDir, 'captures'))
    initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    initSettings(tempDir)
    updateSettings({
      operatorName: 'Det. Smith',
      operatorRole: 'Detective',
      operatorOrganization: 'Metro PD',
      tsaUrl: 'https://tsa.example/timestamp'
    })

    const c = createCase({ name: 'Cert Case', description: 'Certification test case' })
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

  async function exportZip(): Promise<Map<string, Buffer>> {
    const outputPath = join(tempDir, 'evidence.zip')
    await generateReport(caseId, { ...ZIP_OPTIONS, outputPath }, captureLifecycle)
    return readStoredZipEntries(outputPath)
  }

  it('emits certification.html in the ZIP and lists it in evidence.json artifacts', async () => {
    await ingest(caseId, '<html><body>One</body></html>', 'https://example.com/a', 'Page A')
    const entries = await exportZip()

    expect(entries.has('certification.html')).toBe(true)

    const cert = entries.get('certification.html')!
    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      artifacts: Array<{ path: string; sha256: string }>
    }
    const artifact = evidence.artifacts.find((a) => a.path === 'certification.html')
    expect(artifact).toBeDefined()
    expect(artifact!.sha256).toBe(createHash('sha256').update(cert).digest('hex'))
  })

  it('populates certifier fields, tool name/version, hash algorithm, and TSA url', async () => {
    await ingest(caseId, '<html><body>One</body></html>', 'https://example.com/a', 'Page A')
    const entries = await exportZip()
    const html = entries.get('certification.html')!.toString('utf-8')

    expect(html).toContain('Det. Smith')
    expect(html).toContain('Detective')
    expect(html).toContain('Metro PD')
    expect(html).toContain('Birdbrain')
    expect(html).toContain('SHA-256')
    expect(html).toContain('https://tsa.example/timestamp')
    expect(html).toContain('Birdbrain installation ID')
  })

  it('includes the lawyer-TBD placeholder marker', async () => {
    await ingest(caseId, '<html><body>One</body></html>', 'https://example.com/a', 'Page A')
    const entries = await exportZip()
    const html = entries.get('certification.html')!.toString('utf-8')

    expect(html).toContain('[LEGAL WORDING TO BE SUPPLIED BY COUNSEL]')
    expect(html).toContain('LAWYER-TBD')
  })

  it('includes the F6 self-asserted identity statement', async () => {
    await ingest(caseId, '<html><body>One</body></html>', 'https://example.com/a', 'Page A')
    const entries = await exportZip()
    const html = entries.get('certification.html')!.toString('utf-8')

    expect(html).toMatch(/self-asserted/i)
    expect(html).toMatch(/not[\s\S]*cryptographically[\s\S]*authenticated/i)
  })

  it('asserts RFC 3161 trusted time only for the stamped capture in a mixed case', async () => {
    const { capture: stamped } = await ingest(
      caseId,
      '<html><body>Stamped</body></html>',
      'https://example.com/stamped',
      'Stamped Page'
    )
    await ingest(
      caseId,
      '<html><body>Pending</body></html>',
      'https://example.com/pending',
      'Pending Page'
    )

    // Stamp only the first capture with a synthetic token whose messageImprint
    // matches its content hash, so trusted-time resolution yields rfc3161.
    const token = buildSyntheticToken({
      contentHash: stamped.hash,
      genTime: new Date('2026-04-05T12:01:00.000Z'),
      tsaDnsName: 'tsa.example.com'
    })
    appendManifestEntry(join(tempDir, 'captures', caseId), {
      type: 'timestamp',
      caseId,
      captureContentHash: stamped.hash,
      timestamp: '2026-04-05T12:01:00.000Z',
      tsaToken: token.toString('base64'),
      operatorId: 'op',
      operatorName: 'Det. Smith',
      toolVersion: '0.1.0'
    })

    const entries = await exportZip()
    const html = entries.get('certification.html')!.toString('utf-8')

    // No global "all captures trusted-timed" claim when an unstamped capture exists.
    expect(html).not.toMatch(/All \d+ captures? in this export carry an/i)
    // Honest scoped assertion + explicit no-trusted-time statement.
    expect(html).toMatch(/asserted\s+<strong>only<\/strong>/i)
    expect(html).toMatch(/no trusted timestamp is asserted/i)

    // The stamped page appears in the timestamped table; the pending page does not.
    expect(html).toContain('Timestamped captures')
    expect(html).toContain('https://example.com/stamped')
    expect(html).toContain('Captures without trusted time')
    expect(html).toContain('https://example.com/pending')
  })
})
