import { createHash } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getPublicKeyPem } from '@main/services/signingKey'
import { packageHash } from '@shared/verify/packageHash'
import {
  capturePagePath,
  pdfPath,
  screenshotPath,
  transactionRecordPath
} from '../../src/packages/evidence-package-layout/index'
import { EGRESS_OPERATOR, buildSignedChain } from './egressPackage'

// The evidence package whose capture entry carries the capture engine's
// schema-6 fields (docs/plans/2026-10-10-capture-engine-first-slice.md, D1),
// built for the in-process package verifier and for the built binary alike so
// the two are handed the same bytes. Written by hand: nothing in the app writes
// these fields yet. The four files hold invented bytes, because the verifier
// hashes each file and parses none of them.
//
// The caller owns the signing key: it must already be initialised, as the node
// project's setup file does.

export const ENGINE_CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000002'
export const ENGINE_CAPTURE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000003'

export const ENGINE_FILES = {
  page: Buffer.from('<html><body>Captured by the capture engine</body></html>'),
  screenshot: Buffer.from('fixture screenshot bytes'),
  transactionRecord: Buffer.from('fixture Transaction Record bytes'),
  pdf: Buffer.from('%PDF-1.7 fixture bytes')
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

export const ENGINE_HASHES = {
  page: sha256(ENGINE_FILES.page),
  screenshot: sha256(ENGINE_FILES.screenshot),
  transactionRecord: sha256(ENGINE_FILES.transactionRecord),
  pdf: sha256(ENGINE_FILES.pdf)
}

// Every part of D4 present, with each count distinct so a swapped field shows.
export const ENGINE_INVENTORY = {
  mhtml: { present: true, pinnedImages: 12, pinnedImagesNotLoaded: 10 },
  transactionRecord: {
    present: true,
    exchanges: 14,
    cached: 1,
    cancelled: 2,
    failed: 3,
    inFlight: 4,
    finishedWithoutResponse: 13,
    bodiesOmitted: 5,
    incompleteRequestBodies: 6,
    webSockets: 7,
    recordedTargets: 8,
    unrecordedTargets: 9,
    replacedHeaders: ['cookie', 'set-cookie'],
    budget: { totalBytes: 50000000, resourceBytes: 10000000 }
  },
  screenshot: {
    present: true,
    scaled: false,
    truncated: true,
    trimmed: true,
    contentWidth: 1280,
    contentHeight: 40000,
    width: 1280,
    height: 24800
  },
  pdf: { present: true, afterCollection: true }
}

export const ENGINE_SCROLL_TO_LOAD = {
  requested: true,
  ran: true,
  outcome: 'stopped-growing',
  endHeight: 40000,
  scrollLockLifted: true
}

// A TLS 1.2 connection, so every optional key of D7 is present: a separate key
// exchange, its group, and a cipher with its own MAC.
export const ENGINE_BOUND_TLS = {
  protocol: 'TLS 1.2',
  keyExchange: 'ECDHE_RSA',
  keyExchangeGroup: 'P-256',
  cipher: 'AES_128_CBC',
  mac: 'HMAC-SHA1',
  subjectName: 'example.com',
  sanList: ['example.com', 'www.example.com'],
  issuer: 'Example Issuing CA',
  validFrom: '2026-09-01T00:00:00.000Z',
  validTo: '2026-12-01T00:00:00.000Z',
  signedCertificateTimestampList: [
    {
      status: 'Verified',
      origin: 'Embedded in certificate',
      logDescription: 'Example log',
      logId: 'AB01',
      timestamp: '2026-09-01T00:00:01.123Z',
      hashAlgorithm: 'SHA-256',
      signatureAlgorithm: 'ECDSA',
      signatureData: 'CD02'
    }
  ],
  certificateTransparencyCompliance: 'compliant',
  serverSignatureAlgorithm: 1025,
  encryptedClientHello: false
}

// The fields a background Capture with every file would carry. `boundTlsAbsent`
// is the sixth field, and never sits beside `boundTls`.
export function engineFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    inventory: ENGINE_INVENTORY,
    scrollToLoad: ENGINE_SCROLL_TO_LOAD,
    transactionRecordHash: ENGINE_HASHES.transactionRecord,
    boundTls: ENGINE_BOUND_TLS,
    pdfHash: ENGINE_HASHES.pdf,
    ...overrides
  }
}

export function engineCaptureEntry(
  fields: Record<string, unknown> = engineFields()
): Record<string, unknown> {
  return {
    type: 'capture',
    captureId: ENGINE_CAPTURE_ID,
    caseId: ENGINE_CASE_ID,
    url: 'https://example.com/page',
    timestamp: '2026-10-18T12:00:00.000Z',
    contentHash: ENGINE_HASHES.page,
    screenshotHash: ENGINE_HASHES.screenshot,
    method: 'background',
    sizeBytes: ENGINE_FILES.page.length,
    ...fields,
    ...EGRESS_OPERATOR,
    schemaVersion: 6
  }
}

// A case-scoped package holding one capture entry with `fields` on it, sealed
// with its export entry the way generateReport seals one, and every file the
// entry can anchor at its content-addressed path.
export function writeEnginePackage(
  dir: string,
  fields: Record<string, unknown> = engineFields()
): void {
  const exportBody = {
    type: 'export',
    caseId: ENGINE_CASE_ID,
    timestamp: '2026-10-18T12:30:00.000Z',
    ...EGRESS_OPERATOR,
    packageHash: packageHash([]),
    verificationResult: {
      overallValid: true,
      captureCount: 1,
      verifiedCount: 1,
      tamperedCount: 0,
      missingCount: 0
    },
    schemaVersion: 2
  }
  const lines = buildSignedChain([engineCaptureEntry(fields), exportBody])
  const exportLine = lines.pop()!
  const head = JSON.parse(lines[lines.length - 1]) as { index: number; entryHash: string }
  writeFileSync(join(dir, 'manifest.jsonl'), lines.join('\n') + '\n', 'utf-8')
  writeFileSync(join(dir, 'export-entry.json'), exportLine, 'utf-8')
  writeFileSync(join(dir, 'signing-public-key.pem'), getPublicKeyPem(), 'utf-8')
  const files: Array<[string, Buffer]> = [
    [capturePagePath(ENGINE_CAPTURE_ID), ENGINE_FILES.page],
    [screenshotPath(ENGINE_HASHES.screenshot), ENGINE_FILES.screenshot],
    [transactionRecordPath(ENGINE_HASHES.transactionRecord), ENGINE_FILES.transactionRecord],
    [pdfPath(ENGINE_HASHES.pdf), ENGINE_FILES.pdf]
  ]
  for (const [path, bytes] of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), bytes)
  }
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
      captures: [
        {
          id: ENGINE_CAPTURE_ID,
          mhtmlPath: capturePagePath(ENGINE_CAPTURE_ID),
          mhtmlSha256: ENGINE_HASHES.page,
          screenshotPath: screenshotPath(ENGINE_HASHES.screenshot),
          screenshotSha256: ENGINE_HASHES.screenshot,
          timestampTokenPaths: []
        }
      ],
      exhibits: [
        {
          id: ENGINE_CAPTURE_ID,
          kind: 'capture',
          origin: 'background',
          exhibitNumber: 1,
          name: 'Page',
          contentHash: ENGINE_HASHES.page,
          path: capturePagePath(ENGINE_CAPTURE_ID),
          derivedFiles: []
        }
      ],
      artifacts: []
    }),
    'utf-8'
  )
}
