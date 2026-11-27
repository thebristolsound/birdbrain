import { describe, it, expect } from 'vitest'
import { createHash, createSign, generateKeyPairSync } from 'crypto'
import { canonicalStringify, verifyManifestChainText } from '@shared/verify'
import { MANIFEST_SCHEMA_VERSION } from '@shared/constants'

// Known answers for the key rule the chain walk applies, pinned before the
// rule is extracted into one function (slice 1 of
// docs/plans/2026-10-02-manifest-chain-reader.md). The walk applies the rule
// twice today: `keyFor` on a chain this build reads in full, and phase C's
// `anchored` boundaries on a chain that ends at an entry from a newer schema.
// Each case here passes on the unextracted walk and must pass unchanged after.
//
// The #1199 cases pin two genuine chain shapes the walk still reports as
// broken. They are not the right answers; they are today's answers, and
// extracting the rule must not change them. Fixing #1199 changes them on
// purpose, with its own known answers.

type Keys = { publicKey: string; privateKey: string }

function keypair(): Keys {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
}

const SOURCE = keypair()
const MIDDLE = keypair()
const LOCAL = keypair()
const STRANGER = keypair()

const NEWER_SCHEMA = MANIFEST_SCHEMA_VERSION + 1

const OPERATOR = { operatorId: 'inst-a', operatorName: 'Alice', toolVersion: '1.0.0' }

const capture = (n: number): Record<string, unknown> => ({
  type: 'capture',
  captureId: `cap-${n}`,
  caseId: 'case-src',
  url: 'https://example.com',
  timestamp: '2026-07-03T00:00:00.000Z',
  contentHash: 'f'.repeat(64),
  sizeBytes: 10,
  ...OPERATOR
})

const importOf = (carried: Record<string, unknown>): Record<string, unknown> => ({
  type: 'import',
  caseId: 'case-dst',
  sourceCaseId: 'case-src',
  sourceInstallationId: 'inst-a',
  ...carried,
  packageHash: 'a'.repeat(64),
  idMapSha256: 'b'.repeat(64),
  verificationResult: {
    overallValid: true,
    chainValid: true,
    artifactCount: 1,
    artifactFailureCount: 0,
    captureCount: 1,
    captureHashFailureCount: 0
  },
  timestamp: '2026-07-03T01:00:00.000Z',
  ...OPERATOR
})

const carrying = (keys: Keys): Record<string, unknown> =>
  importOf({ sourcePublicKeyPem: keys.publicKey })

// An entry type this build has never heard of, so the walk stops at it.
const newerWriter: Record<string, unknown> = {
  type: 'annotation-burn',
  caseId: 'case-dst',
  timestamp: '2026-07-03T02:00:00.000Z',
  ...OPERATOR,
  schemaVersion: NEWER_SCHEMA
}

/** A chain whose entry i has body `steps[i].body`, signed by `steps[i].signer`. */
function chain(steps: Array<{ body: Record<string, unknown>; signer: Keys }>): string {
  let prevHash = ''
  const lines = steps.map(({ body, signer }, index) => {
    const full = { schemaVersion: 2, ...body, index, prevHash }
    const entryHash = createHash('sha256').update(canonicalStringify(full)).digest('hex')
    const signature = createSign('sha256').update(entryHash).sign(signer.privateKey, 'base64')
    prevHash = entryHash
    return JSON.stringify({ ...full, entryHash, signature })
  })
  return lines.join('\n') + '\n'
}

function verdict(jsonl: string): { valid: boolean; brokenAt?: number; reason?: string } {
  const { valid, brokenAt, reason, unsupported } = verifyManifestChainText(jsonl, {
    publicKeyPem: LOCAL.publicKey
  })
  return {
    valid,
    ...(brokenAt !== undefined ? { brokenAt } : {}),
    ...(reason !== undefined && unsupported === undefined ? { reason } : {}),
    ...(unsupported !== undefined ? { reason: `too old at ${unsupported.index}` } : {})
  }
}

const PASS = { valid: true }
const accused = (brokenAt: number) => ({ valid: false, brokenAt, reason: 'Invalid signature' })

describe('key rule on a chain this build reads in full', () => {
  it('verifies a native chain under the local key alone', () => {
    const jsonl = chain([
      { body: capture(0), signer: LOCAL },
      { body: capture(1), signer: LOCAL }
    ])
    expect(verdict(jsonl)).toEqual(PASS)
  })

  it('verifies an import entry under the next key along, not the key it carries', () => {
    // capture(A), import(A) signed by B, import(B) signed by the local key.
    const good = chain([
      { body: capture(0), signer: SOURCE },
      { body: carrying(SOURCE), signer: MIDDLE },
      { body: carrying(MIDDLE), signer: LOCAL }
    ])
    expect(verdict(good)).toEqual(PASS)

    const selfSigned = chain([
      { body: capture(0), signer: SOURCE },
      { body: carrying(SOURCE), signer: SOURCE },
      { body: carrying(MIDDLE), signer: LOCAL }
    ])
    expect(verdict(selfSigned)).toEqual(accused(1))
  })

  it('splits a two-hop chain into three runs, each closed by the next import', () => {
    const steps = [
      { body: capture(0), signer: SOURCE },
      { body: carrying(SOURCE), signer: MIDDLE },
      { body: capture(2), signer: MIDDLE },
      { body: carrying(MIDDLE), signer: LOCAL },
      { body: capture(4), signer: LOCAL }
    ]
    expect(verdict(chain(steps))).toEqual(PASS)

    // Each entry signed by the key of the run before or after its own is
    // accused at that entry: the runs end exactly at the import boundaries.
    const wrongKeys: Array<[number, Keys]> = [
      [0, MIDDLE],
      [2, SOURCE],
      [2, LOCAL],
      [4, MIDDLE]
    ]
    for (const [at, signer] of wrongKeys) {
      const moved = steps.map((step, i) => (i === at ? { ...step, signer } : step))
      expect(verdict(chain(moved)), `entry ${at}`).toEqual(accused(at))
    }
  })

  it('accuses an entry signed by a key no boundary carries', () => {
    const jsonl = chain([
      { body: capture(0), signer: STRANGER },
      { body: carrying(SOURCE), signer: LOCAL }
    ])
    expect(verdict(jsonl)).toEqual(accused(0))
  })
})

describe('key rule on a chain that ends at an entry from a newer schema (phase C)', () => {
  it('resolves every run before an unreadable import from the boundaries this build read', () => {
    const steps = [
      { body: capture(0), signer: SOURCE },
      { body: carrying(SOURCE), signer: MIDDLE },
      { body: capture(2), signer: MIDDLE },
      { body: { ...carrying(MIDDLE), schemaVersion: NEWER_SCHEMA }, signer: LOCAL }
    ]
    expect(verdict(chain(steps))).toEqual({ valid: false, reason: 'too old at 3' })

    const wrongKeys: Array<[number, Keys]> = [
      [0, MIDDLE],
      [2, LOCAL],
      [2, SOURCE]
    ]
    for (const [at, signer] of wrongKeys) {
      const moved = steps.map((step, i) => (i === at ? { ...step, signer } : step))
      expect(verdict(chain(moved)), `entry ${at}`).toEqual(accused(at))
    }
  })

  it('resolves an imported run under a readable import before an unreadable entry', () => {
    const steps = [
      { body: capture(0), signer: SOURCE },
      { body: carrying(SOURCE), signer: LOCAL },
      { body: newerWriter, signer: LOCAL }
    ]
    expect(verdict(chain(steps))).toEqual({ valid: false, reason: 'too old at 2' })

    const moved = steps.map((step, i) => (i === 0 ? { ...step, signer: LOCAL } : step))
    expect(verdict(chain(moved))).toEqual(accused(0))
  })

  it('verifies the unreadable entry itself under the local key only', () => {
    const jsonl = chain([
      { body: capture(0), signer: SOURCE },
      { body: { ...carrying(SOURCE), schemaVersion: NEWER_SCHEMA }, signer: SOURCE }
    ])
    expect(verdict(jsonl)).toEqual(accused(1))
  })
})

describe('#1199: genuine chains the walk still reports as broken', () => {
  it('shape 1: a newer writer inside an imported segment is accused under the local key', () => {
    // The source installation ran a newer build; its entry's key is the one
    // the import after it carries, which the walk never reaches.
    const jsonl = chain([
      { body: capture(0), signer: SOURCE },
      { body: newerWriter, signer: SOURCE },
      { body: carrying(SOURCE), signer: LOCAL }
    ])
    expect(verdict(jsonl)).toEqual(accused(1))
  })

  it('shape 2: an unreadable import whose key field was renamed resolves to the local key', () => {
    const renamed = importOf({ sourcePublicKey: SOURCE.publicKey })
    const jsonl = chain([
      { body: capture(0), signer: SOURCE },
      { body: { ...renamed, schemaVersion: NEWER_SCHEMA }, signer: LOCAL }
    ])
    expect(verdict(jsonl)).toEqual(accused(0))

    // The segment verifies only when the local key signed it, so the walk
    // fell back to the local key.
    const localOnly = chain([
      { body: capture(0), signer: LOCAL },
      { body: { ...renamed, schemaVersion: NEWER_SCHEMA }, signer: LOCAL }
    ])
    expect(verdict(localOnly)).toEqual({ valid: false, reason: 'too old at 1' })
  })

  it('shape 2: an unreadable import carrying a key this build cannot use accuses under it', () => {
    const unusable = importOf({ sourcePublicKeyPem: 'a key in an encoding from a later schema' })
    const jsonl = chain([
      { body: capture(0), signer: SOURCE },
      { body: { ...unusable, schemaVersion: NEWER_SCHEMA }, signer: LOCAL }
    ])
    expect(verdict(jsonl)).toEqual(accused(0))

    // The same chain signed by the local key throughout is still accused,
    // so the walk used the unusable key, not the local one.
    const localOnly = chain([
      { body: capture(0), signer: LOCAL },
      { body: { ...unusable, schemaVersion: NEWER_SCHEMA }, signer: LOCAL }
    ])
    expect(verdict(localOnly)).toEqual(accused(0))
  })
})
