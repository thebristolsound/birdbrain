import { createHash } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getPublicKeyPem, signEntryHash } from '@main/services/signingKey'
import { canonicalStringify } from '@shared/verify'
import { packageHash } from '@shared/verify/packageHash'

// The one evidence package carrying the Egress fields on a capture entry
// (ADR-0032, #1694), built for the in-process package verifier and for the
// built binary alike so the two are handed the same bytes. Written by hand:
// nothing in the app writes these fields yet, and a fixture the exporter
// produced could only agree with itself.
//
// The caller owns the signing key: it must already be initialised, as the node
// project's setup file does.

export const EGRESS_CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000002'
export const EGRESS_CAPTURE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000001'
export const EGRESS_OPERATOR = {
  operatorId: 'op-1',
  operatorName: 'Casey Operator',
  toolVersion: '0.4.0'
}

// All four fields, as a writer of the Egress setting would record a proxied
// render.
export const EGRESS_FIELDS = {
  egressKind: 'proxy',
  egressLabel: 'Frankfurt VPN',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/152.0.7977.130 Electron/44.4.5',
  tlsSkipped: 'egress-not-direct'
}

const PAGE = Buffer.from('<html><body>Captured through a proxy</body></html>')
const PAGE_HASH = createHash('sha256').update(PAGE).digest('hex')

export function egressCaptureEntry(
  fields: Record<string, unknown> = EGRESS_FIELDS
): Record<string, unknown> {
  return {
    type: 'capture',
    captureId: EGRESS_CAPTURE_ID,
    caseId: EGRESS_CASE_ID,
    url: 'https://example.com/page',
    timestamp: '2026-10-06T12:00:00.000Z',
    contentHash: PAGE_HASH,
    sizeBytes: PAGE.length,
    ...fields,
    ...EGRESS_OPERATOR,
    schemaVersion: 5
  }
}

// Signs each body in order, filling index and prevHash the way
// appendManifestEntry does.
export function buildSignedChain(bodies: Record<string, unknown>[]): string[] {
  let prevHash = ''
  return bodies.map((body, index) => {
    const full = { ...body, index, prevHash }
    const entryHash = createHash('sha256').update(canonicalStringify(full)).digest('hex')
    prevHash = entryHash
    return JSON.stringify({ ...full, entryHash, signature: signEntryHash(entryHash) })
  })
}

// A case-scoped package holding one capture entry with `fields` on it, sealed
// with its export entry the way generateReport seals one.
export function writeEgressPackage(
  dir: string,
  fields: Record<string, unknown> = EGRESS_FIELDS
): void {
  const exportBody = {
    type: 'export',
    caseId: EGRESS_CASE_ID,
    timestamp: '2026-10-06T12:30:00.000Z',
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
  const lines = buildSignedChain([egressCaptureEntry(fields), exportBody])
  const exportLine = lines.pop()!
  const head = JSON.parse(lines[lines.length - 1]) as { index: number; entryHash: string }
  writeFileSync(join(dir, 'manifest.jsonl'), lines.join('\n') + '\n', 'utf-8')
  writeFileSync(join(dir, 'export-entry.json'), exportLine, 'utf-8')
  writeFileSync(join(dir, 'signing-public-key.pem'), getPublicKeyPem(), 'utf-8')
  mkdirSync(join(dir, 'pages'), { recursive: true })
  writeFileSync(join(dir, 'pages', `${EGRESS_CAPTURE_ID}.mhtml`), PAGE)
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
          id: EGRESS_CAPTURE_ID,
          mhtmlPath: `pages/${EGRESS_CAPTURE_ID}.mhtml`,
          mhtmlSha256: PAGE_HASH,
          timestampTokenPaths: []
        }
      ],
      exhibits: [
        {
          id: EGRESS_CAPTURE_ID,
          kind: 'capture',
          origin: 'background',
          exhibitNumber: 1,
          name: 'Page',
          contentHash: PAGE_HASH,
          path: `pages/${EGRESS_CAPTURE_ID}.mhtml`,
          derivedFiles: []
        }
      ],
      artifacts: []
    }),
    'utf-8'
  )
}
