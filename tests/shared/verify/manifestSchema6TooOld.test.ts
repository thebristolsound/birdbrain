import { describe, it, expect, vi, beforeAll } from 'vitest'
import { getPublicKeyPem } from '@main/services/signingKey'
import { buildSignedChain } from '../../helpers/egressPackage'
import { ENGINE_INVENTORY, engineCaptureEntry } from '../../helpers/captureEnginePackage'
import { LINK_CAPTURE_BODY } from '../../helpers/linkProvenance'

// A schema-5 verifier meeting a capture entry that carries the capture engine's
// fields or the link provenance fields (ADR-0023 X25, ADR-0040). This file pins the read ceiling back to 5, the
// release before this one, and hands it a chain whose second entry carries
// the fields under the stamp the writer gives them: the answer must be
// "verifier too old", never a broken chain. Its own file because the mock is
// module-wide; the re-import mirrors manifestSchema5TooOld.test.ts.
vi.mock('@shared/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/constants')>()
  return { ...actual, MANIFEST_SCHEMA_VERSION: 5 }
})

let verifyManifestChainText: typeof import('@shared/verify').verifyManifestChainText
let MANIFEST_SCHEMA_VERSION: number

beforeAll(async () => {
  vi.resetModules()
  ;({ verifyManifestChainText } = await import('@shared/verify'))
  ;({ MANIFEST_SCHEMA_VERSION } = await import('@shared/constants'))
})

const PLAIN_CAPTURE = { ...engineCaptureEntry({}), captureId: 'cap-plain', schemaVersion: 2 }

function verify(lines: string[]) {
  return verifyManifestChainText(lines.join('\n') + '\n', { publicKeyPem: getPublicKeyPem() })
}

describe('a schema-5 verifier against capture entries carrying the capture engine fields', () => {
  it('runs with the read ceiling pinned to 5', () => {
    expect(MANIFEST_SCHEMA_VERSION).toBe(5)
  })

  it('verifies the chain up to the entry without the fields', () => {
    expect(verify(buildSignedChain([PLAIN_CAPTURE])).valid).toBe(true)
  })

  it('reports the entry as verifier too old, not as a broken chain', () => {
    // The entry carries every count of the Transaction Record part, the
    // finished-without-response count included.
    expect(engineCaptureEntry()).toMatchObject({
      inventory: { transactionRecord: { finishedWithoutResponse: 13 } }
    })
    const result = verify(buildSignedChain([PLAIN_CAPTURE, engineCaptureEntry()]))
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBeUndefined()
    expect(result.unsupported).toEqual({
      index: 1,
      entryType: 'capture',
      schemaVersionSeen: 6,
      supportedSchemaVersion: 5
    })
    expect(result.reason).toContain('verifier too old')
    expect(result.reason).toContain('supports up to schema version 5')
  })

  it('reports an entry whose only new field is the inventory the same way', () => {
    // The inventory alone, with the transaction record and PDF absent, still
    // carries the MHTML part's pinned image counts (#1843).
    const inventoryOnly = engineCaptureEntry({
      inventory: {
        ...ENGINE_INVENTORY,
        transactionRecord: { present: false, reason: 'not-taken' },
        pdf: { present: false, reason: 'not-taken' }
      }
    })
    const result = verify(buildSignedChain([PLAIN_CAPTURE, inventoryOnly]))
    expect(result.brokenAt).toBeUndefined()
    expect(result.unsupported).toMatchObject({ index: 1, schemaVersionSeen: 6 })
  })

  it('still reports such an entry that fails its signature as tampering', () => {
    const lines = buildSignedChain([PLAIN_CAPTURE, engineCaptureEntry()])
    const edited = JSON.parse(lines[1]) as Record<string, unknown>
    edited.signature = 'not-a-signature'
    const result = verify([lines[0], JSON.stringify(edited)])
    expect(result.unsupported).toBeUndefined()
    expect(result.brokenAt).toBe(1)
    expect(result.reason).toBe('Invalid signature')
  })
})

describe('a schema-5 verifier against a capture entry carrying the link provenance fields', () => {
  // The entry whose digest manifestSchema6LinkProvenance.test.ts freezes.
  it('reports the entry as verifier too old, not as a broken chain', () => {
    const result = verify(buildSignedChain([PLAIN_CAPTURE, LINK_CAPTURE_BODY]))
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBeUndefined()
    expect(result.unsupported).toEqual({
      index: 1,
      entryType: 'capture',
      schemaVersionSeen: 6,
      supportedSchemaVersion: 5
    })
    expect(result.reason).toContain('verifier too old')
  })
})
