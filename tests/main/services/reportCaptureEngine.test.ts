/**
 * report.html states the capture engine's fields from the signed entry (the
 * capture engine plan's Step 5, #1927). Nothing in the app writes the fields
 * yet, so every entry here is hand-made: the step 1 fixtures, signed through
 * the same chain builder the package tests use.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resolveExportCaptureEngine } from '@main/services/export'
import { readManifestSnapshot } from '@main/services/manifest'
import {
  buildHtmlReport,
  resolveCaptureEngineFacts,
  type CaptureEngineEntry,
  type ReportData
} from '@main/services/reportHtml'
import type { Capture, ExportOptions } from '@shared/types'
import { buildSignedChain } from '../../helpers/egressPackage'
import {
  ENGINE_BOUND_TLS,
  ENGINE_CAPTURE_ID,
  ENGINE_CASE_ID,
  ENGINE_HASHES,
  ENGINE_INVENTORY,
  ENGINE_SCROLL_TO_LOAD,
  engineCaptureEntry,
  engineFields
} from '../../helpers/captureEnginePackage'

const OPTIONS: ExportOptions = {
  format: 'zip',
  exportClass: 'evidence',
  include: {
    captures: true,
    screenshots: false,
    auditTrail: true,
    notes: false,
    annotations: 'none'
  },
  outputPath: '/tmp/unused.zip'
}

function capture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: ENGINE_CAPTURE_ID,
    caseId: ENGINE_CASE_ID,
    url: 'https://example.com/page',
    title: 'Page',
    hash: ENGINE_HASHES.page,
    timestamp: '2026-10-18T12:00:00.000Z',
    createdAt: '2026-10-18T12:00:00.000Z',
    format: 'mhtml',
    method: 'background',
    screenshotHash: ENGINE_HASHES.screenshot,
    ...overrides
  }
}

function reportData(captures: Capture[], extra: Partial<ReportData> = {}): ReportData {
  return {
    caseId: ENGINE_CASE_ID,
    caseName: 'Engine Case',
    dateRange: null,
    exportTimestamp: '2026-10-18T12:30:00.000Z',
    captures,
    verifications: [],
    screenshots: new Map(),
    pins: new Map(),
    installationId: 'install-1',
    operatorName: 'Casey Operator',
    operatorRole: '',
    operatorOrganization: '',
    tsaUrl: 'https://tsa.example/timestamp',
    preflight: {
      captureCount: captures.length,
      stampedCaptureCount: 0,
      unstampedCaptureCount: captures.length,
      pendingCaptureCount: 0,
      noneCaptureCount: captures.length
    },
    toolVersion: '0.4.0',
    manifestHead: null,
    packagedPaths: new Map(),
    chainIdByCaptureId: new Map(captures.map(({ id }) => [id, id])),
    entriesUnderCarriedKeys: false,
    trustedTimeByCaptureId: new Map(),
    entrySignatureByCaptureId: new Map(captures.map(({ id }) => [id, 'signed'])),
    captureEngineByCaptureId: new Map(),
    unreconciledChainCaptureIds: [],
    tsaTrustAnchorBundled: true,
    waybackRefsByCaptureId: new Map(),
    fileExhibits: [],
    exhibitNumberByCaptureId: new Map(captures.map(({ id }, i) => [id, i + 1])),
    exhibitCitationByCaptureId: new Map(),
    derivedFilesByCaptureId: new Map(),
    selectionScope: null,
    ...extra
  }
}

// The signed chain as readManifestSnapshot hands it to the export: parsed lines.
function signedEntries(bodies: Record<string, unknown>[]): Record<string, unknown>[] {
  return buildSignedChain(bodies).map((line) => JSON.parse(line) as Record<string, unknown>)
}

function reportFor(fields: Record<string, unknown>, row: Partial<Capture> = {}): string {
  const facts = resolveCaptureEngineFacts(signedEntries([engineCaptureEntry(fields)]), true)
  return buildHtmlReport(reportData([capture(row)], { captureEngineByCaptureId: facts }), OPTIONS)
}

// What the capture engine blocks add: the report minus the same report built
// without the facts. They are inserted at one point in the exhibit, so the
// shared prefix and suffix leave exactly the new text.
function addedText(withFacts: string, without: string): string {
  let start = 0
  while (start < without.length && withFacts[start] === without[start]) start++
  let end = 0
  while (
    end < without.length - start &&
    withFacts[withFacts.length - 1 - end] === without[without.length - 1 - end]
  ) {
    end++
  }
  return withFacts.slice(start, withFacts.length - end)
}

const SCT = ENGINE_BOUND_TLS.signedCertificateTimestampList[0]

describe('resolveCaptureEngineFacts', () => {
  it('reads the six fields from a signed schema-6 capture entry, keyed by its capture id', () => {
    const resolved = resolveCaptureEngineFacts(signedEntries([engineCaptureEntry()]), true)

    expect([...resolved.keys()]).toEqual([ENGINE_CAPTURE_ID])
    expect(resolved.get(ENGINE_CAPTURE_ID)).toEqual({
      facts: {
        inventory: ENGINE_INVENTORY,
        scrollToLoad: ENGINE_SCROLL_TO_LOAD,
        transactionRecordHash: ENGINE_HASHES.transactionRecord,
        boundTls: ENGINE_BOUND_TLS,
        pdfHash: ENGINE_HASHES.pdf
      },
      chainVerified: true
    })
  })

  it("carries the caller's chain verdict with each Capture's fields", () => {
    const resolved = resolveCaptureEngineFacts(signedEntries([engineCaptureEntry()]), false)
    expect(resolved.get(ENGINE_CAPTURE_ID)?.chainVerified).toBe(false)
  })

  it('carries boundTlsAbsent when the entry has it', () => {
    const fields = engineFields({ boundTls: undefined, boundTlsAbsent: 'from-cache' })
    const facts = resolveCaptureEngineFacts(signedEntries([engineCaptureEntry(fields)]), true).get(
      ENGINE_CAPTURE_ID
    )?.facts

    expect(facts?.boundTlsAbsent).toBe('from-cache')
    expect(facts?.boundTls).toBeUndefined()
  })

  it('lets the last entry for a capture win', () => {
    const later = engineFields({
      scrollToLoad: { requested: true, ran: false, scrollLockLifted: false }
    })
    const replaced = resolveCaptureEngineFacts(
      signedEntries([engineCaptureEntry(), engineCaptureEntry(later)]),
      true
    )
    expect(replaced.get(ENGINE_CAPTURE_ID)?.facts.scrollToLoad).toEqual({
      requested: true,
      ran: false,
      scrollLockLifted: false
    })

    const cleared = resolveCaptureEngineFacts(
      signedEntries([engineCaptureEntry(), engineCaptureEntry({})]),
      true
    )
    expect(cleared.has(ENGINE_CAPTURE_ID)).toBe(false)
  })

  it('yields nothing for an entry the strict schema refuses', () => {
    // Schema-6 fields under a schema-5 stamp, which the verifier rejects.
    const refused = { ...engineCaptureEntry(), schemaVersion: 5 }
    expect(resolveCaptureEngineFacts(signedEntries([refused]), true).size).toBe(0)
  })

  it('skips entries that are not capture entries', () => {
    const deletion = { type: 'deletion', captureId: ENGINE_CAPTURE_ID }
    const facts = resolveCaptureEngineFacts([deletion, { type: 'capture' }], true)
    expect(facts.size).toBe(0)
  })

  // In a Shared Case a deletion its author did not write leaves the Capture in
  // the package (evidencePackage.ts), so a deletion naming it must not clear
  // the fields its capture entry records.
  it('keeps the fields when a deletion entry names the same capture', () => {
    const [captureLine] = signedEntries([engineCaptureEntry()])
    const deletion = { type: 'deletion', captureId: ENGINE_CAPTURE_ID }
    const resolved = resolveCaptureEngineFacts([captureLine, deletion], true)

    expect(resolved.get(ENGINE_CAPTURE_ID)?.facts.inventory).toEqual(ENGINE_INVENTORY)
  })
})

describe('report.html capture engine fields', () => {
  it('renders every field of a Capture carrying all of them', () => {
    const html = reportFor(engineFields())

    // Inventory: each file, the MHTML counts, and the screenshot record.
    expect(html).toContain('Artifact inventory')
    expect(html).toContain(
      '12 images were offered as a set of sources and pinned to the source the page displayed before the save'
    )
    expect(html).toMatch(
      /and 10 of them were still loading that source, or had failed to, when the wait before the save\s+ended\. The counts cover only images in the page's own document/
    )
    expect(html).toMatch(/taken, 1280 × 24800 pixels, of a\s+content area of 1280 × 40000 CSS/)
    expect(html).toMatch(/Scaled\s+down: no\. Cut short of the content height: yes\./)
    expect(html).toContain('Trailing background trimmed: yes.')
    expect(html).toContain(ENGINE_HASHES.transactionRecord)
    expect(html).toContain('taken, printed after network collection stopped')
    expect(html).toContain(ENGINE_HASHES.pdf)

    // Transaction Record counts, each value distinct in the fixture.
    const counts: Array<[string, number]> = [
      ['Exchanges recorded as a request and a response (each redirect hop counts)', 14],
      ['Served from the cache, recorded as a request only', 1],
      ['Cancelled, recorded as a request only', 2],
      ['Failed, recorded as a request only', 3],
      ['Still in flight when collection stopped, recorded as a request only', 4],
      ['Finished with no response, recorded as a request only', 13],
      [
        'Responses recorded without their body, which was over the size budget or which the browser did not return',
        5
      ],
      ['Requests whose body the browser did not hand over in full', 6],
      ['WebSocket connections opened, whose messages are not recorded', 7],
      ['Targets recorded: the page, and the frames and workers whose setup answered', 8],
      [
        'Targets not recorded, whose setup failed, did not answer, or was not attempted; requests made in or below one may be missing from the record',
        9
      ]
    ]
    for (const [label, value] of counts) {
      expect(html).toContain(`<li>${label}: <span class="mono">${value}</span></li>`)
    }
    expect(html).toContain('Headers present with their values replaced: <code>cookie</code>, ')
    expect(html).toContain('<code>set-cookie</code>. Each named header appears in the record')
    expect(html).toMatch(/A token\s+in a URL, a body, or any other header stays in the record\./)
    expect(html).toContain(
      '47.7 MB (50000000 bytes) in total, 9.5 MB (10000000 bytes) per resource'
    )

    // Scroll-to-load.
    expect(html).toContain(
      'Requested, and ran; it stopped when the page stopped growing and scrolling made no progress.'
    )
    expect(html).toContain('The last document height it read was 40000 CSS pixels.')
    expect(html).toContain("It lifted the page's scroll lock")

    // Bound TLS Details, every field.
    expect(html).toContain("Bound TLS Details: the browser's summary of the captured transaction")
    expect(html).toContain(
      'They hold no certificate bytes, so they support no independent signature check.'
    )
    for (const line of [
      'Protocol: TLS 1.2',
      'Key exchange: ECDHE_RSA, group P-256',
      'Cipher: AES_128_CBC, MAC HMAC-SHA1',
      'Subject: example.com',
      'Subject alternative names: example.com, www.example.com',
      'Issuer: Example Issuing CA',
      'Certificate validity period, as the browser reported it: 2026-09-01T00:00:00Z to 2026-12-01T00:00:00Z',
      'Certificate Transparency compliance, as the browser reported it: compliant',
      'Server signature algorithm: 1025 (TLS SignatureScheme code point)',
      'Encrypted Client Hello: not used'
    ]) {
      expect(html).toContain(`<li>${line}</li>`)
    }
    expect(html).toContain('Signed certificate timestamps: 1')
    expect(html).toContain(
      `${SCT.logDescription} (log ID <span class="mono break">${SCT.logId}</span>), at ` +
        `2026-09-01T00:00:01Z; status as reported: ${SCT.status}; origin: ${SCT.origin}; ` +
        `${SCT.hashAlgorithm} with ${SCT.signatureAlgorithm}, signature ` +
        `<span class="mono break">${SCT.signatureData}</span>`
    )
  })

  it('keeps Bound TLS Details in a block of their own, apart from the TLS Cert Chain note', () => {
    const tlsCertChain = {
      url: 'https://example.com/page',
      refetchedAt: '2026-10-18T12:00:05.000Z',
      chain: []
    }
    const html = reportFor(engineFields(), { tlsCertChain })
    const blocks = html.split('<div class="note">')
    const bound = blocks.filter((block) => block.includes('Bound TLS Details'))
    const corroboration = blocks.filter((block) =>
      block.includes('Corroboration only — not bound to the capture')
    )

    expect(bound).toHaveLength(1)
    expect(corroboration).toHaveLength(1)
    expect(bound[0]).not.toContain('Corroboration only')
    expect(corroboration[0]).not.toContain('Bound TLS Details')
  })

  it('states each absence and the shapes with optional parts left out', () => {
    const html = reportFor(
      engineFields({
        inventory: {
          ...ENGINE_INVENTORY,
          mhtml: { present: true, pinnedImages: 1, pinnedImagesNotLoaded: 0 },
          transactionRecord: { present: false, reason: 'not-taken' },
          pdf: { present: false, reason: 'failed' }
        },
        transactionRecordHash: undefined,
        pdfHash: undefined,
        scrollToLoad: { requested: true, ran: false, scrollLockLifted: false },
        boundTls: undefined,
        boundTlsAbsent: 'not-recorded'
      })
    )

    expect(html).toContain(
      '1 image was offered as a set of sources and pinned to the source the page displayed before the save'
    )
    expect(html).toContain(
      'Transaction Record:</strong> not taken: the build that made this capture does not take this file.'
    )
    expect(html).toContain(
      'PDF:</strong> not stored: the capture engine attempted this file and stored none.'
    )
    expect(html).not.toContain('<p class="note-title">Transaction Record</p>')
    expect(html).toContain('Requested, and did not run. It did not lift a scroll lock.')
    expect(html).toContain(
      'The manifest entry records no Bound TLS Details: this capture has no Transaction Record.'
    )
  })

  it.each([
    ['not-https', 'the main document was not served over HTTPS'],
    ['from-cache', 'the response for the main document reported a cache hit'],
    [
      'not-reported',
      'the browser reported no security details on the response for the main document'
    ]
  ])('states the Bound TLS absence %s', (reason, text) => {
    const html = reportFor(engineFields({ boundTls: undefined, boundTlsAbsent: reason }))
    expect(html).toContain(`The manifest entry records no Bound TLS Details: ${text}.`)
  })

  it.each([
    ['nothing-to-scroll', 'it found nothing to scroll'],
    ['height-cap', 'it stopped when the page reached the height limit the phase scrolls to'],
    ['time-budget', 'it stopped when the phase reached its time limit']
  ])('states the Scroll-to-load outcome %s', (outcome, text) => {
    const html = reportFor(engineFields({ scrollToLoad: { ...ENGINE_SCROLL_TO_LOAD, outcome } }))
    expect(html).toContain(`Requested, and ran; ${text}.`)
  })

  it('states a phase that ran with no outcome or end height recorded', () => {
    const html = reportFor(
      engineFields({ scrollToLoad: { requested: true, ran: true, scrollLockLifted: false } })
    )
    expect(html).toContain(
      'Requested, and ran; the entry records no outcome. It did not lift a scroll lock.'
    )
    expect(html).not.toContain('The last document height it read')
  })

  it('states an empty replaced-header list and the TLS fields a connection may not report', () => {
    const html = reportFor(
      engineFields({
        inventory: {
          ...ENGINE_INVENTORY,
          transactionRecord: { ...ENGINE_INVENTORY.transactionRecord, replacedHeaders: [] }
        },
        boundTls: {
          ...ENGINE_BOUND_TLS,
          keyExchange: '',
          keyExchangeGroup: undefined,
          mac: undefined,
          sanList: [],
          serverSignatureAlgorithm: undefined,
          signedCertificateTimestampList: [],
          encryptedClientHello: true
        }
      })
    )

    expect(html).toContain(
      'The entry names no header whose value was replaced. A token in a URL, a body, or any header stays in the record.'
    )
    expect(html).toContain('<li>Key exchange: not applicable, as the browser reported it</li>')
    expect(html).toContain('<li>Cipher: AES_128_CBC</li>')
    expect(html).toContain('<li>Subject alternative names: none</li>')
    expect(html).toContain('<li>Server signature algorithm: not reported</li>')
    expect(html).toContain('<li>Encrypted Client Hello: used</li>')
    expect(html).toContain('Signed certificate timestamps: 0')
  })

  // Every free-text value the browser reported; the closed enums, the integers
  // and the schema-checked dates cannot carry markup.
  const TLS_TEXT_FIELDS = [
    'protocol',
    'keyExchange',
    'keyExchangeGroup',
    'cipher',
    'mac',
    'subjectName',
    'issuer'
  ] as const
  const SCT_TEXT_FIELDS = [
    'status',
    'origin',
    'logDescription',
    'logId',
    'hashAlgorithm',
    'signatureAlgorithm',
    'signatureData'
  ] as const
  const markup = (name: string): string => `<i>${name}</i>`
  const escaped = (name: string): string => `&lt;i&gt;${name}&lt;/i&gt;`

  it.each(TLS_TEXT_FIELDS)('escapes the reported TLS field %s', (name) => {
    const html = reportFor(
      engineFields({ boundTls: { ...ENGINE_BOUND_TLS, [name]: markup(name) } })
    )
    expect(html).toContain(escaped(name))
    expect(html).not.toContain(markup(name))
  })

  it('escapes a reported subject alternative name', () => {
    const html = reportFor(
      engineFields({ boundTls: { ...ENGINE_BOUND_TLS, sanList: ['a.example', markup('san')] } })
    )
    expect(html).toContain(`a.example, ${escaped('san')}`)
    expect(html).not.toContain(markup('san'))
  })

  it.each(SCT_TEXT_FIELDS)('escapes the reported timestamp field %s', (name) => {
    const html = reportFor(
      engineFields({
        boundTls: {
          ...ENGINE_BOUND_TLS,
          signedCertificateTimestampList: [{ ...SCT, [name]: markup(name) }]
        }
      })
    )
    expect(html).toContain(escaped(name))
    expect(html).not.toContain(markup(name))
  })

  it('renders a Capture without the fields as today, whatever its row holds', () => {
    // The row's mirror columns carry values, and its signed entry carries none.
    const mirrored = capture({
      inventory: ENGINE_INVENTORY as Capture['inventory'],
      scrollToLoad: ENGINE_SCROLL_TO_LOAD as Capture['scrollToLoad'],
      transactionRecordHash: ENGINE_HASHES.transactionRecord,
      boundTls: ENGINE_BOUND_TLS as Capture['boundTls'],
      pdfHash: ENGINE_HASHES.pdf
    })
    const facts = resolveCaptureEngineFacts(signedEntries([engineCaptureEntry({})]), true)
    expect(facts.size).toBe(0)

    const today = buildHtmlReport(reportData([capture()]), OPTIONS)
    const withRow = buildHtmlReport(
      reportData([mirrored], { captureEngineByCaptureId: facts }),
      OPTIONS
    )

    expect(withRow).toBe(today)
    for (const title of ['Artifact inventory', 'Scroll-to-load', 'Bound TLS Details']) {
      expect(today).not.toContain(title)
    }
  })

  it("states the signed entry's values when the row's columns were edited after ingest", () => {
    const edited = capture({
      inventory: {
        ...ENGINE_INVENTORY,
        transactionRecord: { ...ENGINE_INVENTORY.transactionRecord, exchanges: 999 }
      } as Capture['inventory'],
      scrollToLoad: { ...ENGINE_SCROLL_TO_LOAD, outcome: 'time-budget' } as Capture['scrollToLoad'],
      transactionRecordHash: 'f'.repeat(64),
      boundTls: { ...ENGINE_BOUND_TLS, subjectName: 'forged.example' } as Capture['boundTls'],
      pdfHash: 'e'.repeat(64)
    })
    const html = reportFor(engineFields(), edited)

    expect(html).toContain(
      '<li>Exchanges recorded as a request and a response (each redirect hop counts): <span class="mono">14</span></li>'
    )
    expect(html).not.toContain('<span class="mono">999</span>')
    expect(html).toContain('it stopped when the page stopped growing')
    expect(html).not.toContain('it stopped when the phase reached its time limit')
    expect(html).toContain('<li>Subject: example.com</li>')
    expect(html).not.toContain('forged.example')
    expect(html).toContain(ENGINE_HASHES.transactionRecord)
    expect(html).not.toContain('f'.repeat(64))
    expect(html).not.toContain('e'.repeat(64))
  })

  it('finds the fields by the id the signed entry names when the row was renamed', () => {
    const facts = new Map<string, CaptureEngineEntry>([
      [
        ENGINE_CAPTURE_ID,
        {
          facts: { scrollToLoad: { requested: true, ran: false, scrollLockLifted: false } },
          chainVerified: true
        }
      ]
    ])
    const renamed = capture({ id: 'renamed-row-id' })
    const html = buildHtmlReport(
      reportData([renamed], {
        chainIdByCaptureId: new Map([['renamed-row-id', ENGINE_CAPTURE_ID]]),
        captureEngineByCaptureId: facts
      }),
      OPTIONS
    )
    expect(html).toContain('Requested, and did not run.')
  })

  it('never calls the Transaction Record complete or uses an unqualified assurance word', () => {
    // A connection whose reported values hold none of the words checked, so
    // only the report's own wording is tested.
    const fields = engineFields({
      boundTls: {
        ...ENGINE_BOUND_TLS,
        certificateTransparencyCompliance: 'unknown',
        signedCertificateTimestampList: [{ ...SCT, status: 'Unknown' }]
      }
    })
    const added = addedText(reportFor(fields), buildHtmlReport(reportData([capture()]), OPTIONS))

    expect(added).toContain('Transaction Record')
    for (const word of [
      /complete/i,
      /tamper-proof/i,
      /court-admissible/i,
      /forensically sound/i,
      /\bverified\b/i,
      /\bcompliant\b/i,
      /\bguarantee/i,
      /\bproves?\b/i,
      /\bauthentic/i
    ]) {
      expect(added).not.toMatch(word)
    }
    // The record is named as a packet capture, or as bytes from the wire, only
    // to say it is not one.
    expect(added.match(/packet capture/g)).toHaveLength(1)
    expect(added).toContain('It is not a packet capture and holds no bytes read from the network')
    expect(added).not.toMatch(/\bwire\b/i)
  })

  it('states the validity period and Certificate Transparency compliance as the browser reported them', () => {
    const added = addedText(
      reportFor(engineFields()),
      buildHtmlReport(reportData([capture()]), OPTIONS)
    )

    // The reported value `compliant` appears once, on the row that qualifies it.
    expect(added.match(/compliant/g)).toHaveLength(1)
    expect(added).toContain(
      '<li>Certificate Transparency compliance, as the browser reported it: compliant</li>'
    )
    expect(added).not.toMatch(/<li>Valid/)
    expect(added).toContain(
      '<li>Certificate validity period, as the browser reported it: 2026-09-01T00:00:00Z to 2026-12-01T00:00:00Z</li>'
    )
  })
})

// The export's read of the chain: the fields are quoted only when the chain
// verifies over the same snapshot they are read from (resolveExportCaptureEngine).
describe('report.html capture engine fields over a chain that does not verify', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bb-report-engine-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function reportOver(lines: string[]): string {
    writeFileSync(join(dir, 'manifest.jsonl'), lines.join('\n') + '\n', 'utf-8')
    const engine = resolveExportCaptureEngine(readManifestSnapshot(dir), { chains: [] })
    return buildHtmlReport(reportData([capture()], { captureEngineByCaptureId: engine }), OPTIONS)
  }

  it('quotes the fields from a chain that verifies', () => {
    const html = reportOver(buildSignedChain([engineCaptureEntry()]))

    expect(html).toContain('Artifact inventory')
    expect(html).toContain(
      '<li>Exchanges recorded as a request and a response (each redirect hop counts): <span class="mono">14</span></li>'
    )
    expect(html).not.toContain('Capture engine fields not reported')
  })

  it('reports a tampered entry as unverified and quotes none of its values', () => {
    const [line] = buildSignedChain([engineCaptureEntry()])
    const tampered = JSON.parse(line) as {
      inventory: { transactionRecord: { exchanges: number } }
      signature?: string
    }
    tampered.inventory.transactionRecord.exchanges = 999
    delete tampered.signature
    const html = reportOver([JSON.stringify(tampered)])

    expect(html).toContain('Capture engine fields not reported')
    expect(html).toMatch(/the manifest chain did not\s+verify when this report was generated/)
    expect(html).not.toContain('<span class="mono">999</span>')
    expect(html).not.toContain('Artifact inventory')
    expect(html).not.toContain('signed manifest entry for this capture records')
    expect(html).not.toContain('Bound TLS Details')
  })
})
