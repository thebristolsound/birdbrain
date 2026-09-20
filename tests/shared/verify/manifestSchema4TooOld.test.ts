import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createHash } from 'crypto'
import { getPublicKeyPem, signEntryHash } from '@main/services/signingKey'
import { canonicalStringify } from '@shared/verify'

// A schema-3 verifier meeting a schema-4 chain (#1509, ADR-0023 X25). This
// file pins the read ceiling back to 3 — the constant is the only thing that
// separates the previous release's verify-core from this one on this path —
// and hands it a genuine Shared Case chain: the answer must be "verifier too
// old", never a broken chain, and the entries before the first schema-4 one
// must still verify. Its own file because the mock is module-wide.
//
// The node project's setup file initializes the signing key before this
// module's mocks register, and that import already pulled `@shared/constants`
// into the registry, so verify-core is re-imported after a resetModules to
// pick the mock up. The signing key keeps its statically imported instance:
// verify-core only ever sees the PEM string.
vi.mock('@shared/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/constants')>()
  return { ...actual, MANIFEST_SCHEMA_VERSION: 3 }
})

let verifyManifestChainText: typeof import('@shared/verify').verifyManifestChainText
let MANIFEST_SCHEMA_VERSION: number

beforeAll(async () => {
  vi.resetModules()
  ;({ verifyManifestChainText } = await import('@shared/verify'))
  ;({ MANIFEST_SCHEMA_VERSION } = await import('@shared/constants'))
})

const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000002'
const OPERATOR = { operatorId: 'inst-owner', operatorName: 'Casey Operator', toolVersion: '0.5.0' }

function buildChain(bodies: Record<string, unknown>[]): string {
  let prevHash = ''
  return (
    bodies
      .map((body, index) => {
        const full = { ...body, index, prevHash }
        const entryHash = createHash('sha256').update(canonicalStringify(full)).digest('hex')
        prevHash = entryHash
        return JSON.stringify({ ...full, entryHash, signature: signEntryHash(entryHash) })
      })
      .join('\n') + '\n'
  )
}

describe('a schema-3 verifier against a schema-4 chain', () => {
  it('runs with the read ceiling pinned to 3', () => {
    expect(MANIFEST_SCHEMA_VERSION).toBe(3)
  })

  it('reports the first schema-4 entry as verifier too old, not as a broken chain', () => {
    const chain = buildChain([
      {
        type: 'exhibit',
        exhibitId: 'x-1',
        caseId: CASE_ID,
        kind: 'document',
        origin: 'manual-upload',
        name: 'statement.pdf',
        exhibitNumber: 1,
        path: `${CASE_ID}/documents/x-1.pdf`,
        contentHash: 'a'.repeat(64),
        sizeBytes: 1,
        timestamp: '2026-09-19T12:00:00.000Z',
        ...OPERATOR,
        schemaVersion: 3
      },
      {
        type: 'member-add',
        caseId: CASE_ID,
        memberInstallationId: 'inst-owner',
        memberPublicKeyPem: getPublicKeyPem(),
        memberCode: 'CO',
        memberOperatorName: 'Casey Operator',
        nodeId: 'node-owner',
        role: 'owner',
        timestamp: '2026-09-19T12:01:00.000Z',
        ...OPERATOR,
        schemaVersion: 4
      }
    ])
    const result = verifyManifestChainText(chain, { publicKeyPem: getPublicKeyPem() })
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBeUndefined()
    expect(result.unsupported).toEqual({
      index: 1,
      entryType: 'member-add',
      schemaVersionSeen: 4,
      supportedSchemaVersion: 3
    })
    expect(result.reason).toContain('verifier too old')
    expect(result.reason).toContain('supports up to schema version 3')
  })

  it('reports a known type carrying a schema-4 field as verifier too old', () => {
    // `memberCode` and `subject` ride on types a schema-3 verifier knows, so
    // the version stamp is all that tells it the entry is not broken. That is
    // why the schema-4 reader refuses either field below 4 (#1518 review).
    const bodies = [
      {
        type: 'exhibit',
        exhibitId: 'x-2',
        caseId: CASE_ID,
        kind: 'document',
        origin: 'manual-upload',
        name: 'statement.pdf',
        exhibitNumber: 2,
        memberCode: 'CO',
        path: `${CASE_ID}/documents/x-2.pdf`,
        contentHash: 'a'.repeat(64),
        sizeBytes: 1,
        timestamp: '2026-09-19T12:00:00.000Z',
        ...OPERATOR,
        schemaVersion: 4
      },
      {
        type: 'timestamp',
        caseId: CASE_ID,
        captureContentHash: 'a'.repeat(64),
        subject: 'entry',
        timestamp: '2026-09-19T12:03:00.000Z',
        ...OPERATOR,
        schemaVersion: 4
      }
    ]
    for (const body of bodies) {
      const result = verifyManifestChainText(buildChain([body]), {
        publicKeyPem: getPublicKeyPem()
      })
      expect(result.brokenAt, body.type).toBeUndefined()
      expect(result.unsupported, body.type).toMatchObject({
        index: 0,
        entryType: body.type,
        schemaVersionSeen: 4
      })
    }
  })

  it('still reports a schema-4 entry that fails its signature as tampering', () => {
    // The too-old exculpation costs the signing key under either ceiling.
    const lines = buildChain([
      {
        type: 'merge',
        caseId: CASE_ID,
        heads: [
          { installationId: 'inst-b', index: 0, entryHash: 'a'.repeat(64), entriesReceived: 1 }
        ],
        timestamp: '2026-09-19T12:02:00.000Z',
        ...OPERATOR,
        schemaVersion: 4
      }
    ])
      .trim()
      .split('\n')
    const edited = JSON.parse(lines[0]) as Record<string, unknown>
    edited.signature = 'not-a-signature'
    const result = verifyManifestChainText(JSON.stringify(edited) + '\n', {
      publicKeyPem: getPublicKeyPem()
    })
    expect(result.unsupported).toBeUndefined()
    expect(result.brokenAt).toBe(0)
    expect(result.reason).toBe('Invalid signature')
  })
})
