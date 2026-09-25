import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { createHash } from 'crypto'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase, updateCase } from '@main/services/db/caseRepo'
import { createNote } from '@main/services/db/noteRepo'
import { getPublicKeyPem } from '@main/services/signingKey'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { appendManifestEntry, initManifest } from '@main/services/manifest'
import {
  ingestMhtmlCapture,
  createCaptureLifecycle,
  type CaptureLifecycle
} from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { generateReport } from '@main/services/export'
import { buildCertification } from '@main/services/certification'
import { resolveToolVersion } from '@main/services/toolVersion'
import type { EntrySignatureStatus } from '@main/services/reportHtml'
import { insertCapture, setCaptureTrustedTime } from '@main/services/db/captureRepo'
import { defaultCaptureStore } from '@main/services/captureStore'
import { canonicalStringify } from '@shared/verify'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { buildSyntheticToken } from '../../helpers/timestampFixtures'
import type { ExportOptions } from '@shared/types'
import type { TrustedTimeResult } from '@shared/verify'

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

// A pre-signing manifest entry: schemaVersion 1, with no `signature` key at all,
// which resolveEntrySignatures reports as 'unsigned-legacy'. Written as the
// genesis entry because a chain may go v1 -> v2 as the tool was upgraded but
// never back — verifyManifestChain rejects a v1 entry after a signed one as a
// schema downgrade, which is a different finding entirely.
async function seedLegacyGenesisCapture(caseId: string, caseDir: string) {
  const bytes = 'legacy bytes'
  const capture = insertCapture({
    caseId,
    url: 'https://legacy.example/page',
    title: 'Legacy Page',
    hash: createHash('sha256').update(bytes).digest('hex'),
    timestamp: '2026-04-05T11:00:00.000Z'
  })
  await defaultCaptureStore.writeMhtmlStream(
    caseId,
    capture.id,
    Readable.from([Buffer.from(bytes)]) as unknown as ReadableStream<Uint8Array>
  )

  const body = {
    type: 'capture',
    captureId: capture.id,
    caseId,
    url: 'https://legacy.example/page',
    timestamp: '2026-04-05T11:00:00.000Z',
    contentHash: capture.hash,
    sizeBytes: Buffer.byteLength(bytes),
    operatorId: 'op',
    operatorName: '',
    toolVersion: '0.0.1',
    index: 0,
    prevHash: '',
    schemaVersion: 1
  }
  writeFileSync(
    join(caseDir, 'manifest.jsonl'),
    JSON.stringify({
      ...body,
      entryHash: createHash('sha256').update(canonicalStringify(body)).digest('hex')
    }) + '\n'
  )

  return capture
}

// A capture the DB holds and the chain never recorded, which
// resolveEntrySignatures reports as 'no-entry'. Bytes are written so the export
// can package it; only the manifest entry is missing.
async function seedUnchainedCapture(caseId: string) {
  const bytes = 'unchained bytes'
  const capture = insertCapture({
    caseId,
    url: 'https://unchained.example/page',
    title: 'Unchained Page',
    hash: createHash('sha256').update(bytes).digest('hex'),
    timestamp: '2026-04-05T11:30:00.000Z'
  })
  await defaultCaptureStore.writeMhtmlStream(
    caseId,
    capture.id,
    Readable.from([Buffer.from(bytes)]) as unknown as ReadableStream<Uint8Array>
  )
  return capture
}

// The per-exhibit 'Entry signature' rail labels report.html prints, which the
// certification's summary counts must reconcile against.
const REPORT_SIGNATURE_LABELS = {
  signed: 'Present',
  'unsigned-legacy': 'Absent (pre-signing tool version)',
  'no-entry': 'No manifest entry'
} as const

function countReportSignatureRows(report: string, status: keyof typeof REPORT_SIGNATURE_LABELS) {
  const label = REPORT_SIGNATURE_LABELS[status]
  const pattern = new RegExp(
    `Entry signature[\\s\\S]{0,200}?<span class="strong">${label.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    )}</span>`,
    'g'
  )
  return report.match(pattern)?.length ?? 0
}

// The Entry signatures section alone, so a negative assertion is not satisfied
// or tripped by wording elsewhere in the certificate.
function entrySignatureSection(cert: string) {
  const start = cert.indexOf('Entry signatures</h2>')
  const end = cert.indexOf('Certifier</h2>', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return cert.slice(start, end)
}

// The package-level fields a direct buildCertification call must supply since
// #399; the trusted-time tests using this spread do not read any of them.
const DIRECT_INPUT_EXTRAS = {
  isDemo: false,
  manifestHead: null,
  signingKeyFingerprint: 'f'.repeat(64),
  contents: { captureCount: 1, screenshotCount: 0, noteCount: 0 }
}

const ZIP_OPTIONS: ExportOptions = {
  format: 'zip',
  include: { captures: true, screenshots: false, auditTrail: true, notes: false, annotations: 'none' },
  exportClass: 'evidence',
  outputPath: ''
}

describe('certification', () => {
  let tempDir: string
  let caseId: string
  let captureLifecycle: CaptureLifecycle

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-cert-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    initSettings(tempDir)
    updateSettings({
      operatorName: 'Alex Smith',
      operatorRole: 'Researcher',
      operatorOrganization: 'Independent Research Group',
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

  async function exportZip(overrides: Partial<ExportOptions> = {}): Promise<Map<string, Buffer>> {
    const outputPath = join(tempDir, 'evidence.zip')
    await generateReport(caseId, { ...ZIP_OPTIONS, ...overrides, outputPath }, captureLifecycle)
    return readStoredZipEntries(outputPath)
  }

  // Stands in for the timestamp worker's tick. verify() computes its result first
  // and appends the token afterwards, so the HashVerification carries the state
  // before the append and the manifest snapshot generateReport takes later carries
  // the state after it — the two disagreeing reads any artifact could pick from.
  function stampAfterVerify(contentHash: string, token: Buffer): CaptureLifecycle {
    return {
      ...captureLifecycle,
      verify: async (captureId: string) => {
        const result = await captureLifecycle.verify(captureId)
        appendManifestEntry(join(tempDir, 'captures', caseId), {
          type: 'timestamp',
          caseId,
          captureContentHash: contentHash,
          timestamp: '2026-04-05T12:01:00.000Z',
          tsaToken: token.toString('base64'),
          operatorId: 'op',
          operatorName: 'Alex Smith',
          toolVersion: '0.1.0'
        })
        return result
      }
    }
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

    expect(html).toContain('Alex Smith')
    expect(html).toContain('Researcher')
    expect(html).toContain('Independent Research Group')
    expect(html).toContain('Birdbrain')
    expect(html).toContain('SHA-256')
    expect(html).toContain('https://tsa.example/timestamp')
    expect(html).toContain('Installation identifier')
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
      operatorName: 'Alex Smith',
      toolVersion: '0.1.0'
    })

    const entries = await exportZip()
    const html = entries.get('certification.html')!.toString('utf-8')

    // No global "all captures trusted-timed" claim when an unstamped capture exists.
    expect(html).not.toMatch(/All \d+ captures? in this export carry an/i)
    // Honest scoped assertion + explicit no-trusted-time statement.
    expect(html).toMatch(/asserted\s+<strong>only<\/strong>/i)
    // Whitespace-tolerant: the sentence wraps across source lines inside the
    // template literal, so the emitted HTML carries newlines mid-phrase.
    expect(html).toMatch(/no\s+trusted\s+timestamp\s+is\s+asserted/i)

    // The stamped page appears in the timestamped table; the pending page does not.
    expect(html).toContain('Timestamped exhibits')
    expect(html).toContain('https://example.com/stamped')
    expect(html).toContain('Exhibits without trusted time')
    expect(html).toContain('https://example.com/pending')
  })

  // #492: unchecking Audit Trail skips verification, so data.verifications is
  // empty and the per-capture rows fall through. They must fall through to the
  // manifest snapshot — the same source the preflight counts printed in the same
  // document come from — not to the rebuildable captures.trustedTimeStatus
  // mirror, which can disagree with the tokens actually retained.
  it('resolves per-capture trusted time from the manifest, not the mirror, without an audit trail', async () => {
    const { capture } = await ingest(
      caseId,
      '<html><body>Stamped</body></html>',
      'https://example.com/stamped',
      'Stamped Page'
    )

    // Manifest says rfc3161; the mirror disagrees and says none.
    const token = buildSyntheticToken({
      contentHash: capture.hash,
      genTime: new Date('2026-04-05T12:01:00.000Z'),
      tsaDnsName: 'tsa.example.com'
    })
    appendManifestEntry(join(tempDir, 'captures', caseId), {
      type: 'timestamp',
      caseId,
      captureContentHash: capture.hash,
      timestamp: '2026-04-05T12:01:00.000Z',
      tsaToken: token.toString('base64'),
      operatorId: 'op',
      operatorName: 'Alex Smith',
      toolVersion: '0.1.0'
    })
    setCaptureTrustedTime(capture.id, 'none')

    const entries = await exportZip({
      include: { ...ZIP_OPTIONS.include, auditTrail: false }
    })
    const html = entries.get('certification.html')!.toString('utf-8')

    expect(html).toContain('Timestamped exhibits')
    expect(html).toContain('https://example.com/stamped')
    // The mirror's verdict must not surface anywhere in the document.
    expect(html).not.toContain('Exhibits without trusted time')
    expect(html).not.toContain('Local clock only')

    // #492's second consequence: a manifest-sourced stamped row must still name
    // the authority and the time it asserted. Those were parsed out of the token
    // during resolution, so a row that prints the generic placeholder instead is
    // discarding evidence the package already holds.
    expect(html).toContain('tsa.example.com')
    expect(html).toContain('2026-04-05T12:01:00Z')
    expect(html).not.toContain('RFC 3161 TSA')
  })

  // #492: the summary counts and the rows beneath them are one resolution taken
  // from the manifest snapshot the package is built from — the same snapshot that
  // becomes the bundled manifest.jsonl. What this pins is that both read that
  // snapshot and nothing earlier. Run against 31b1c43 the document rendered "No
  // trusted timestamps are asserted for any of the 1 capture in this export (1
  // pending, 0 none)" above a "Token pending" row: internally consistent, but an
  // under-claim, because the packaged manifest already carried the token and the
  // rows were still reading the verification computed before it arrived.
  it('asserts the token the packaged manifest carries when it lands mid-export', async () => {
    const { capture } = await ingest(
      caseId,
      '<html><body>Raced</body></html>',
      'https://example.com/raced',
      'Raced Page'
    )

    const token = buildSyntheticToken({
      contentHash: capture.hash,
      genTime: new Date('2026-04-05T12:01:00.000Z'),
      tsaDnsName: 'tsa.example.com'
    })

    const outputPath = join(tempDir, 'raced.zip')
    await generateReport(
      caseId,
      { ...ZIP_OPTIONS, outputPath },
      stampAfterVerify(capture.hash, token)
    )
    const html = readStoredZipEntries(outputPath).get('certification.html')!.toString('utf-8')

    expect(html).toMatch(/All 1 exhibit in this export carry an/i)
    expect(html).toContain('Timestamped exhibits')
    expect(html).toContain('tsa.example.com')
    expect(html).not.toContain('Exhibits without trusted time')
    expect(html).not.toMatch(/remaining capture/i)
  })

  // #492/#498: the three artifacts are read side by side out of one zip, and the
  // package verifier re-derives the axis from the bundled manifest.jsonl — which
  // is that same snapshot (src/shared/verify/evidencePackage.ts:191). So an
  // artifact that prefers HashVerification.trustedTime, a live manifest read taken
  // at verify time, contradicts both the other two and the manifest it ships
  // beside. This interleaving separates the two reads: the verification predates
  // the token, the snapshot follows it.
  it('ships one trusted-time answer across certification, report and evidence.json', async () => {
    const { capture } = await ingest(
      caseId,
      '<html><body>Raced</body></html>',
      'https://example.com/raced',
      'Raced Page'
    )

    const token = buildSyntheticToken({
      contentHash: capture.hash,
      genTime: new Date('2026-04-05T12:01:00.000Z'),
      tsaDnsName: 'tsa.example.com'
    })

    const outputPath = join(tempDir, 'agree.zip')
    await generateReport(
      caseId,
      { ...ZIP_OPTIONS, outputPath },
      stampAfterVerify(capture.hash, token)
    )
    const entries = readStoredZipEntries(outputPath)
    const cert = entries.get('certification.html')!.toString('utf-8')
    const report = entries.get('report.html')!.toString('utf-8')
    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      captures: Array<{ id: string; trustedTime: string; tsaName?: string; stampedAt?: string }>
    }

    expect(cert).toMatch(/All 1 exhibit in this export carry an/i)
    expect(cert).toContain('tsa.example.com')
    expect(cert).not.toContain('Token pending')

    expect(report).toContain('RFC 3161 token retained')
    expect(report).not.toContain('Local clock — token pending')

    expect(evidence.captures).toHaveLength(1)
    expect(evidence.captures[0]).toMatchObject({
      id: capture.id,
      trustedTime: 'rfc3161',
      tsaName: 'tsa.example.com',
      stampedAt: '2026-04-05T12:01:00.000Z'
    })
  })

  it('lets the manifest override a mirror that overclaims trusted time', async () => {
    const { capture } = await ingest(
      caseId,
      '<html><body>Unstamped</body></html>',
      'https://example.com/unstamped',
      'Unstamped Page'
    )
    setCaptureTrustedTime(capture.id, 'rfc3161')

    // No timestamp entry was appended, so the manifest snapshot resolves 'none'.
    const html = buildCertification(
      {
        caseName: 'Cert Case',
        ...DIRECT_INPUT_EXTRAS,
        exportTimestamp: '2026-04-05T13:00:00.000Z',
        installationId: 'install-1',
        operatorName: 'Alex Smith',
        operatorRole: 'Researcher',
        operatorOrganization: 'Independent Research Group',
        tsaUrl: 'https://tsa.example/timestamp',
        captures: [{ ...capture, trustedTimeStatus: 'rfc3161' }],
        trustedTimeByCaptureId: new Map<string, TrustedTimeResult>([
          [capture.id, { trustedTime: 'none' }]
        ]),
        entrySignatureByCaptureId: new Map<string, EntrySignatureStatus>([[capture.id, 'signed']])
      },
      resolveToolVersion()
    )

    expect(html).toContain('Exhibits without trusted time')
    expect(html).toContain('Local clock only')
    expect(html).not.toContain('Timestamped exhibits')
    expect(html).not.toMatch(/All \d+ captures? in this export carry an/i)
  })

  // The summary sentence is folded out of the rows it introduces, so the
  // document has no second count to contradict them with (#492).
  it('counts the trusted-time summary from the rows it prints', async () => {
    const { capture: stamped } = await ingest(
      caseId,
      '<html><body>Stamped</body></html>',
      'https://example.com/stamped',
      'Stamped Page'
    )
    const { capture: pending } = await ingest(
      caseId,
      '<html><body>Pending</body></html>',
      'https://example.com/pending',
      'Pending Page'
    )

    const html = buildCertification(
      {
        caseName: 'Cert Case',
        ...DIRECT_INPUT_EXTRAS,
        exportTimestamp: '2026-04-05T13:00:00.000Z',
        installationId: 'install-1',
        operatorName: 'Alex Smith',
        operatorRole: 'Researcher',
        operatorOrganization: 'Independent Research Group',
        tsaUrl: 'https://tsa.example/timestamp',
        captures: [stamped, pending],
        trustedTimeByCaptureId: new Map<string, TrustedTimeResult>([
          [
            stamped.id,
            {
              trustedTime: 'rfc3161',
              tsaName: 'tsa.example.com',
              stampedAt: '2026-04-05T12:01:00.000Z'
            }
          ],
          [pending.id, { trustedTime: 'pending' }]
        ]),
        entrySignatureByCaptureId: new Map<string, EntrySignatureStatus>([
          [stamped.id, 'signed'],
          [pending.id, 'signed']
        ])
      },
      resolveToolVersion()
    )

    expect(html).toMatch(/only<\/strong>\s+for\s+the\s+1\s+exhibit/i)
    expect(html).toMatch(/1\s+remaining\s+exhibit\s+\(1\s+pending,\s+0\s+none\)/i)
    expect(html).toContain('tsa.example.com')
    expect(html).toContain('2026-04-05T12:01:00Z')
  })

  // #1169. An operator who declined trusted timestamping never contacted the
  // configured authority, so no packaged document may name one. Printing the
  // endpoint beside a process paragraph about hashes being submitted to a TSA is
  // what turns "Where enabled" into an apparent claim about this export.
  describe('an installation that declined trusted timestamping', () => {
    it('names no authority in either packaged document', async () => {
      await ingest(
        caseId,
        '<html><body>Declined</body></html>',
        'https://example.com/declined',
        'Declined Page'
      )
      updateSettings({ tsaEnabled: false })

      const entries = await exportZip()
      const certification = entries.get('certification.html')!.toString('utf-8')
      const report = entries.get('report.html')!.toString('utf-8')

      for (const html of [certification, report]) {
        expect(html).toContain('Time-stamping authority (configured)')
        expect(html).toContain('trusted timestamping is switched off for this installation')
        expect(html).not.toContain('https://tsa.example/timestamp')
      }
    })

    it('still names the authority when timestamping is left on', async () => {
      await ingest(
        caseId,
        '<html><body>Enabled</body></html>',
        'https://example.com/enabled',
        'Enabled Page'
      )

      const entries = await exportZip()
      const certification = entries.get('certification.html')!.toString('utf-8')
      const report = entries.get('report.html')!.toString('utf-8')

      for (const html of [certification, report]) {
        expect(html).toContain('https://tsa.example/timestamp')
        expect(html).not.toContain('switched off for this installation')
      }
    })

    it('does not tell a reader that a timestamp was requested for an unstamped exhibit', async () => {
      // The manifest records tokens, not requests. With timestamping declined no
      // request was made at all, so prose asserting one is simply false — and it
      // was already unsupported before the opt-out existed.
      await ingest(
        caseId,
        '<html><body>Unstamped</body></html>',
        'https://example.com/unstamped',
        'Unstamped Page'
      )
      updateSettings({ tsaEnabled: false })

      const report = (await exportZip()).get('report.html')!.toString('utf-8')

      expect(report).toContain('No RFC 3161 token is recorded for this capture')
      expect(report).not.toMatch(/timestamp was requested but/i)
    })
  })

  // #611. The signature axis gets the #492 treatment the trusted-time axis has:
  // one map in, summary folded out of the same rows report.html states per
  // exhibit. A package cannot then say "all signed" over a report that names a
  // legacy entry.
  describe('entry signature counts (#611)', () => {
    it('counts signed, legacy and unchained captures and reconciles them with report.html', async () => {
      const caseDir = join(tempDir, 'captures', caseId)
      await seedLegacyGenesisCapture(caseId, caseDir)
      await ingest(
        caseId,
        '<html><body>Signed</body></html>',
        'https://example.com/signed',
        'Signed'
      )
      await seedUnchainedCapture(caseId)

      const entries = await exportZip()
      const cert = entries.get('certification.html')!.toString('utf-8')
      const report = entries.get('report.html')!.toString('utf-8')

      expect(cert).toContain('Entry signatures')
      expect(cert).toMatch(
        /A\s+signature\s+is\s+present\s+on\s+the\s+manifest\s+entry\s+for\s+1\s+of\s+the\s+3/
      )
      expect(cert).toMatch(
        /remaining\s+2\s+exhibits\s+\(1\s+with\s+an\s+unsigned\s+entry,\s+1\s+with\s+no\s+manifest\s+entry\)/
      )
      expect(cert).toMatch(/no\s+entry\s+signature\s+is\s+asserted/i)

      // AC3: the summary is the per-exhibit disclosure, counted. A second
      // aggregation path would be free to disagree with these rows.
      expect(countReportSignatureRows(report, 'signed')).toBe(1)
      expect(countReportSignatureRows(report, 'unsigned-legacy')).toBe(1)
      expect(countReportSignatureRows(report, 'no-entry')).toBe(1)
    })

    // Every coverage claim this section once made (chain linkage, the export
    // entry's packageHash, "and by nothing else") was false for some capture
    // class, so the section states counts and no claim about what covers the rest.
    it('makes no coverage claim for any unsigned class', async () => {
      const caseDir = join(tempDir, 'captures', caseId)
      await seedLegacyGenesisCapture(caseId, caseDir)
      await ingest(
        caseId,
        '<html><body>Signed</body></html>',
        'https://example.com/signed',
        'Signed'
      )
      await seedUnchainedCapture(caseId)

      const entries = await exportZip()
      const section = entrySignatureSection(entries.get('certification.html')!.toString('utf-8'))

      expect(section).not.toMatch(/chain\s+linkage/)
      expect(section).not.toMatch(/covered\s+by/)
      expect(section).not.toMatch(/nothing\s+else/)
      expect(section).not.toMatch(/packageHash|export-entry\.json/)
    })

    // AC4: absence of legacy entries is unremarkable, so it is stated as an
    // all-clear rather than as a row of zeroes a reader has to interpret.
    it('states an all-clear with no zero counts when every entry is signed', async () => {
      await ingest(caseId, '<html><body>One</body></html>', 'https://example.com/1', 'One')
      await ingest(caseId, '<html><body>Two</body></html>', 'https://example.com/2', 'Two')

      const entries = await exportZip()
      const cert = entries.get('certification.html')!.toString('utf-8')

      expect(cert).toMatch(
        /present\s+on\s+the\s+manifest\s+entry\s+for\s+every\s+exhibit\s+in\s+this\s+export\s+\(2\s+of\s+2\)/
      )
      expect(cert).not.toMatch(/no\s+entry\s+signature\s+is\s+asserted/i)
      expect(cert).not.toMatch(/with\s+an\s+unsigned\s+entry/)
      expect(cert).not.toMatch(/with\s+no\s+manifest\s+entry/)
      expect(
        countReportSignatureRows(entries.get('report.html')!.toString('utf-8'), 'signed')
      ).toBe(2)
    })

    // resolveEntrySignatures reports 'signed' for any string in `signature`, so
    // the all-clear can assert presence and must not assert that it verifies, or
    // against which key: an entry inherited across an import verifies against the
    // key in the import entry, not the enclosed signing-public-key.pem.
    it('asserts signature presence and not verifiability when every entry is signed', async () => {
      await ingest(caseId, '<html><body>One</body></html>', 'https://example.com/1', 'One')

      const entries = await exportZip()
      const section = entrySignatureSection(entries.get('certification.html')!.toString('utf-8'))

      expect(section).toMatch(/A\s+signature\s+is\s+present/)
      expect(section).not.toMatch(/verif/i)
      expect(section).not.toMatch(/public\s+key|signing-public-key\.pem/)
    })

    it('makes no signature claim at all when the chain holds only a legacy entry', async () => {
      await seedLegacyGenesisCapture(caseId, join(tempDir, 'captures', caseId))

      const entries = await exportZip()
      const cert = entries.get('certification.html')!.toString('utf-8')

      expect(cert).toMatch(
        /No\s+entry\s+signature\s+is\s+asserted<\/strong>\s+for\s+any\s+of\s+the\s+1\s+exhibit\s+in\s+this\s+export\s+\(1\s+with\s+an\s+unsigned\s+entry,\s+0\s+with\s+no\s+manifest\s+entry\)/
      )
      expect(cert).not.toMatch(/signature\s+is\s+present/)
    })

    // AC4 at the other edge: with no captures the none-signed branch would
    // print a bolded negative finding, a row of zeroes and a coverage claim
    // about the empty set.
    it('prints no finding at all for an export containing no captures', () => {
      const html = buildCertification(
        {
          caseName: 'Cert Case',
          ...DIRECT_INPUT_EXTRAS,
          contents: { captureCount: 0, screenshotCount: 0, noteCount: 0 },
          exportTimestamp: '2026-04-05T13:00:00.000Z',
          installationId: 'install-1',
          operatorName: 'Det. Smith',
          operatorRole: 'Detective',
          operatorOrganization: 'Metro PD',
          tsaUrl: 'https://tsa.example/timestamp',
          captures: [],
          trustedTimeByCaptureId: new Map<string, TrustedTimeResult>(),
          entrySignatureByCaptureId: new Map<string, EntrySignatureStatus>()
        },
        resolveToolVersion()
      )

      expect(html).toMatch(/This\s+export\s+contains\s+no\s+exhibits/)
      expect(html).not.toMatch(/No\s+entry\s+signature\s+is\s+asserted/)
      expect(html).not.toMatch(/written\s+before\s+per-entry\s+signing/)
      expect(html).not.toMatch(/manifest\s+chain\s+linkage/)
    })

    // AC5. resolveEntrySignatures backfills 'no-entry' for every capture, so a
    // missing key is a broken invariant, not a legacy capture. Defaulting one
    // would understate the unsigned share silently — the #1110 failure on the
    // trusted-time axis. Refusing is loud.
    it('refuses to certify a capture the signature resolution never saw', async () => {
      const { capture } = await ingest(
        caseId,
        '<html><body>One</body></html>',
        'https://example.com/1',
        'One'
      )

      expect(() =>
        buildCertification(
          {
            caseName: 'Cert Case',
            ...DIRECT_INPUT_EXTRAS,
            exportTimestamp: '2026-04-05T13:00:00.000Z',
            installationId: 'install-1',
            operatorName: 'Det. Smith',
            operatorRole: 'Detective',
            operatorOrganization: 'Metro PD',
            tsaUrl: 'https://tsa.example/timestamp',
            captures: [capture],
            trustedTimeByCaptureId: new Map<string, TrustedTimeResult>(),
            entrySignatureByCaptureId: new Map<string, EntrySignatureStatus>()
          },
          resolveToolVersion()
        )
      ).toThrow(new RegExp(`no entry signature resolved for capture ${capture.id}`))
    })
  })

  describe('extended certification (#399)', () => {
    async function exportCert(overrides: Partial<ExportOptions> = {}): Promise<string> {
      const entries = await exportZip(overrides)
      return entries.get('certification.html')!.toString('utf-8')
    }

    it('renders case number, contents, manifest head and the signing key fingerprint', async () => {
      updateCase({ id: caseId, caseNumber: 'CPS 2026/114' })
      await ingest(caseId, '<html><body>One</body></html>', 'https://example.com/1', 'One')
      createNote({ caseId, title: 'N', body: 'note body' })

      const cert = await exportCert({
        include: {
          captures: true,
          screenshots: false,
          auditTrail: true,
          notes: true,
          annotations: 'none'
        },
        purposeOrAuthority: 'Disclosure under CPS request 2026/114'
      })

      expect(cert).toContain('Case number (self-asserted)')
      expect(cert).toContain('CPS 2026/114')
      expect(cert).toContain('1 capture, 0 screenshots, 1 operator note')
      // The head cited is the same single snapshot the package was built from.
      expect(cert).toMatch(/Manifest head at export[\s\S]*?entry #\d+ · [0-9a-f]{64}/)
      expect(cert).toContain('Signing key (SHA-256 of signing-public-key.pem)')
      expect(cert).toContain(
        createHash('sha256').update(Buffer.from(getPublicKeyPem(), 'utf-8')).digest('hex')
      )
      expect(cert).toContain('Purpose or authority (self-asserted)')
      expect(cert).toContain('Disclosure under CPS request 2026/114')
    })

    it("renders 'not stated' for an absent case number and purpose", async () => {
      await ingest(caseId, '<html><body>One</body></html>', 'https://example.com/1', 'One')

      const cert = await exportCert()

      // Two 'not stated' cells beyond the existing role/organisation ones —
      // absent values are stated as absent, never rendered as empty cells.
      expect(cert).toMatch(
        /Case number \(self-asserted\)<\/div>\s*<div class="field-value">not stated/
      )
      expect(cert).toMatch(
        /Purpose or authority \(self-asserted\)<\/div>\s*<div class="field-value">not stated/
      )
    })

    it('states the demonstration case prominently, and only for a demo case', async () => {
      getDb().prepare('UPDATE cases SET is_demo = 1 WHERE id = ?').run(caseId)
      await ingest(caseId, '<html><body>Demo</body></html>', 'https://example.com/d', 'Demo')

      const demoCert = await exportCert()
      expect(demoCert).toContain('Demonstration case')
      expect(demoCert).toContain('fixture data')
      expect(demoCert).toContain('must not be presented as collected evidence')

      getDb().prepare('UPDATE cases SET is_demo = 0 WHERE id = ?').run(caseId)
      const plainCert = await exportCert()
      expect(plainCert).not.toContain('Demonstration case')
      expect(plainCert).not.toContain('fixture data')
    })

    it('uses Operator vocabulary only — never Examiner, never analyst', async () => {
      await ingest(caseId, '<html><body>One</body></html>', 'https://example.com/1', 'One')

      const cert = await exportCert({
        include: {
          captures: true,
          screenshots: false,
          auditTrail: true,
          notes: true,
          annotations: 'none'
        }
      })

      expect(cert).not.toMatch(/examiner/i)
      expect(cert).not.toMatch(/analyst/i)
      expect(cert).not.toMatch(/investigator/i)
    })

    it('counts excluded notes as zero in the contents summary', async () => {
      await ingest(caseId, '<html><body>One</body></html>', 'https://example.com/1', 'One')
      createNote({ caseId, title: 'N', body: 'excluded from this export' })

      const cert = await exportCert()

      // ZIP_OPTIONS has notes off: the summary states the exclusion plainly.
      expect(cert).toContain('1 capture, 0 screenshots, 0 operator notes')
    })
  })
})
