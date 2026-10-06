import { describe, it, expect, vi, beforeAll } from 'vitest'
import { getPublicKeyPem } from '@main/services/signingKey'
import { buildSignedChain, egressCaptureEntry } from '../../helpers/egressPackage'

// A schema-4 verifier meeting a capture entry that carries the Egress fields
// (#1694, ADR-0032, ADR-0023 X25). This file pins the read ceiling back to 4,
// the release before this one, and hands it a chain whose second entry carries
// all four fields under the stamp the writer gives them: the answer must be
// "verifier too old", never a broken chain. Its own file because the mock is
// module-wide; the re-import mirrors manifestSchema4TooOld.test.ts.
vi.mock('@shared/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/constants')>()
  return { ...actual, MANIFEST_SCHEMA_VERSION: 4 }
})

let verifyManifestChainText: typeof import('@shared/verify').verifyManifestChainText
let MANIFEST_SCHEMA_VERSION: number

beforeAll(async () => {
  vi.resetModules()
  ;({ verifyManifestChainText } = await import('@shared/verify'))
  ;({ MANIFEST_SCHEMA_VERSION } = await import('@shared/constants'))
})

const DIRECT_CAPTURE = egressCaptureEntry({})
const DIRECT_CAPTURE_V2 = { ...DIRECT_CAPTURE, captureId: 'cap-direct', schemaVersion: 2 }

function verify(lines: string[]) {
  return verifyManifestChainText(lines.join('\n') + '\n', { publicKeyPem: getPublicKeyPem() })
}

describe('a schema-4 verifier against capture entries carrying the Egress fields', () => {
  it('runs with the read ceiling pinned to 4', () => {
    expect(MANIFEST_SCHEMA_VERSION).toBe(4)
  })

  it('reports the entry as verifier too old, not as a broken chain', () => {
    const result = verify(buildSignedChain([DIRECT_CAPTURE_V2, egressCaptureEntry()]))
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBeUndefined()
    expect(result.unsupported).toEqual({
      index: 1,
      entryType: 'capture',
      schemaVersionSeen: 5,
      supportedSchemaVersion: 4
    })
    expect(result.reason).toContain('verifier too old')
    expect(result.reason).toContain('supports up to schema version 4')
  })

  it('still reports such an entry that fails its signature as tampering', () => {
    const lines = buildSignedChain([DIRECT_CAPTURE_V2, egressCaptureEntry()])
    const edited = JSON.parse(lines[1]) as Record<string, unknown>
    edited.signature = 'not-a-signature'
    const result = verify([lines[0], JSON.stringify(edited)])
    expect(result.unsupported).toBeUndefined()
    expect(result.brokenAt).toBe(1)
    expect(result.reason).toBe('Invalid signature')
  })
})
