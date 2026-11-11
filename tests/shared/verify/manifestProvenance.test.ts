import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getPublicKeyPem } from '@main/services/signingKey'
import { VERIFY_SCRIPT } from '@main/services/verifyScript'
import { verifyManifestChainText } from '@shared/verify'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import { ManifestEntrySchema } from '@shared/schemas'
import { MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import { PACKAGE_ROOT_FILES } from '../../../src/packages/evidence-package-layout/index'
import { HAS_JQ } from '../../helpers/jq'
import { HAS_OPENSSL } from '../../helpers/openssl'
import { checkConformance } from '../../helpers/verifyConformance'
import { buildSignedChain } from '../../helpers/egressPackage'
import { writeEnginePackage } from '../../helpers/captureEnginePackage'
import {
  LAUNCHED_CAPTURE_BODY,
  PASSIVE_CAPTURE_BODY,
  SCHEMA_2_CAPTURE_BODY
} from '../../helpers/launchedBrowser'

// Known-answer tests for the capture entry's provenance invariants (#1000, as
// the maintainer ruled on 2026-11-09 in
// https://github.com/thebristolsound/birdbrain/issues/1000#issuecomment-6752508679):
// the schema refuses only the shapes whose method and provenance fields
// contradict each other, at every schema version. The answers frozen here:
//   1. each contradicting shape is refused with its own message, at every
//      version, and a shape breaking two rules carries both messages;
//   2. every shape the app writes still parses at every version it can carry,
//      and a chain and a package holding them still verify at each signed
//      schema version;
//   3. the app and package verifiers fail a chain holding a contradicting
//      entry, and verify.sh, which reads none of these fields, still passes it.

const SUPERSEDES_MESSAGE = '`supersedesCaptureId` requires method `background`'
const DUPLICATE_METHOD_MESSAGE =
  '`duplicateOfCaptureId` and `duplicatedAt` require method `duplicate`'
const DUPLICATE_PAIR_MESSAGE = '`duplicateOfCaptureId` and `duplicatedAt` must be present together'
const DUPLICATE_NEEDS_PAIR_MESSAGE =
  'method `duplicate` requires `duplicateOfCaptureId` and `duplicatedAt`'

const SOURCE_ID = '0196f7a2-aaaa-bbbb-cccc-0000000000aa'
const DUPLICATE_PAIR = {
  duplicateOfCaptureId: SOURCE_ID,
  duplicatedAt: '2026-10-01T09:00:00.000Z'
}

const VERSIONS = Array.from({ length: MANIFEST_SCHEMA_VERSION }, (_, i) => i + 1)
// The signed versions: the chain verifier checks signatures from schema 2 on.
const SIGNED_VERSIONS = VERSIONS.filter((version) => version >= 2)

// The shapes the extension ingest, Add URLs, Recapture and Duplicate write on
// a capture entry: no method, a background method with no recapture link, a
// background method with one, and the duplicate method with both halves of
// its pair. The launched browser's two methods carry no link and need schema
// 7; they are accepted below.
const WRITTEN_SHAPES: Array<[string, Record<string, unknown>]> = [
  ['an extension capture, which names no method', {}],
  ['a first-time background capture from Add URLs', { method: 'background' }],
  ['a recapture', { method: 'background', supersedesCaptureId: SOURCE_ID }],
  ['a duplicate', { method: 'duplicate', ...DUPLICATE_PAIR }]
]

// One shape per rule, each breaking that rule alone.
const ONE_RULE_SHAPES: Array<[string, Record<string, unknown>, string]> = [
  [
    'a recapture link on an extension capture',
    { method: 'extension', supersedesCaptureId: SOURCE_ID },
    SUPERSEDES_MESSAGE
  ],
  ['a recapture link with no method', { supersedesCaptureId: SOURCE_ID }, SUPERSEDES_MESSAGE],
  [
    'a recapture link on a duplicate',
    { method: 'duplicate', ...DUPLICATE_PAIR, supersedesCaptureId: SOURCE_ID },
    SUPERSEDES_MESSAGE
  ],
  [
    'a duplicate link on a background capture',
    { method: 'background', ...DUPLICATE_PAIR },
    DUPLICATE_METHOD_MESSAGE
  ],
  ['a duplicate link with no method', DUPLICATE_PAIR, DUPLICATE_METHOD_MESSAGE],
  [
    'a duplicate source with no copy time',
    { method: 'duplicate', duplicateOfCaptureId: SOURCE_ID },
    DUPLICATE_PAIR_MESSAGE
  ],
  [
    'a copy time with no duplicate source',
    { method: 'duplicate', duplicatedAt: DUPLICATE_PAIR.duplicatedAt },
    DUPLICATE_PAIR_MESSAGE
  ],
  [
    'a duplicate with neither half of its pair',
    { method: 'duplicate' },
    DUPLICATE_NEEDS_PAIR_MESSAGE
  ]
]

function body(fields: Record<string, unknown>, schemaVersion: number): Record<string, unknown> {
  return { ...SCHEMA_2_CAPTURE_BODY, ...fields, schemaVersion }
}

function issues(entryBody: Record<string, unknown>) {
  return (
    ManifestEntrySchema.safeParse({ ...entryBody, entryHash: 'f'.repeat(64) }).error?.issues ?? []
  )
}

function messages(fields: Record<string, unknown>, schemaVersion: number): string[] {
  return issues(body(fields, schemaVersion)).map(({ message }) => message)
}

describe('capture entry provenance invariants — the schema', () => {
  for (const [label, fields, message] of ONE_RULE_SHAPES) {
    it(`refuses ${label} with its own message, at every schema version`, () => {
      for (const version of VERSIONS)
        expect(messages(fields, version), `v${version}`).toEqual([message])
    })
  }

  it('gives each rule its own message', () => {
    const refused = ONE_RULE_SHAPES.map(([, fields]) =>
      messages(fields, MANIFEST_SCHEMA_VERSION).join('\n')
    )
    expect(new Set(refused).size).toBe(4)
  })

  it('carries both messages on half a pair under another method', () => {
    const fields = { method: 'background', duplicatedAt: DUPLICATE_PAIR.duplicatedAt }
    for (const version of VERSIONS) {
      expect(messages(fields, version), `v${version}`).toEqual([
        DUPLICATE_METHOD_MESSAGE,
        DUPLICATE_PAIR_MESSAGE
      ])
    }
  })

  for (const [label, fields] of WRITTEN_SHAPES) {
    it(`accepts ${label}, at every schema version`, () => {
      for (const version of VERSIONS) expect(messages(fields, version), `v${version}`).toEqual([])
    })
  }

  it('accepts a launched and a passive capture, which carry no link, at schema 7', () => {
    expect(issues(LAUNCHED_CAPTURE_BODY)).toEqual([])
    expect(issues(PASSIVE_CAPTURE_BODY)).toEqual([])
  })
})

describe('capture entry provenance invariants — the verifiers', () => {
  let pkgDir: string

  beforeEach(() => {
    pkgDir = mkdtempSync(join(tmpdir(), 'birdbrain-provenance-pkg-'))
  })

  afterEach(() => {
    rmSync(pkgDir, { recursive: true, force: true })
  })

  const verifyChain = (bodies: Record<string, unknown>[]) =>
    verifyManifestChainText(buildSignedChain(bodies).join('\n') + '\n', {
      publicKeyPem: getPublicKeyPem()
    })

  const chainRow = (result: ReturnType<typeof verifyEvidencePackage>) =>
    result.checks.find((check) => check.name === 'manifest chain')

  it('verifies a chain holding every written shape, at each signed schema version', () => {
    for (const version of SIGNED_VERSIONS) {
      const result = verifyChain(WRITTEN_SHAPES.map(([, fields]) => body(fields, version)))
      expect(result.reason, `v${version}`).toBeUndefined()
      expect(result.valid, `v${version}`).toBe(true)
    }
  })

  for (const [label, fields] of WRITTEN_SHAPES.slice(1)) {
    it(`passes a package holding ${label}, at each signed schema version`, () => {
      for (const version of SIGNED_VERSIONS) {
        writeEnginePackage(pkgDir, fields, version)
        const result = verifyEvidencePackage(pkgDir)
        expect(
          result.checks.filter(({ status }) => status === 'fail'),
          `v${version}`
        ).toEqual([])
        expect(result.pass, `v${version}`).toBe(true)
      }
    })
  }

  for (const [label, fields] of ONE_RULE_SHAPES) {
    it(`breaks the chain at ${label}`, () => {
      const result = verifyChain([
        body({}, 2),
        body({ ...fields, captureId: '0196f7a2-aaaa-bbbb-cccc-0000000000bb' }, 2)
      ])
      expect(result.valid).toBe(false)
      expect(result.brokenAt).toBe(1)
      expect(result.reason).toBe('Invalid entry shape')
    })
  }

  it('fails the chain of a package holding each contradicting shape', () => {
    for (const [label, fields] of ONE_RULE_SHAPES) {
      writeEnginePackage(pkgDir, { method: undefined, ...fields }, MANIFEST_SCHEMA_VERSION)
      const result = verifyEvidencePackage(pkgDir)
      expect(result.pass, label).toBe(false)
      expect(chainRow(result), label).toEqual({
        name: 'manifest chain',
        status: 'fail',
        reason: 'Invalid entry shape (at index 0)'
      })
    }
  })

  const conformance = (fields: Record<string, unknown>, version: number) => {
    rmSync(pkgDir, { recursive: true, force: true })
    pkgDir = mkdtempSync(join(tmpdir(), 'birdbrain-provenance-pkg-'))
    writeEnginePackage(pkgDir, fields, version, { indexArtifacts: true })
    writeFileSync(join(pkgDir, PACKAGE_ROOT_FILES.verifyScript), VERIFY_SCRIPT, 'utf-8')
    return checkConformance(pkgDir)
  }

  // verify.sh reads none of the fields these rules name, so the two shapes that
  // carry one are run once each, at the current version.
  for (const [label, fields] of WRITTEN_SHAPES.slice(2)) {
    it.skipIf(!HAS_JQ || !HAS_OPENSSL)(
      `passes verify.sh and Package Verification alike on ${label}`,
      () => {
        const result = conformance(fields, MANIFEST_SCHEMA_VERSION)
        expect({ binary: result.binary, script: result.script }, result.scriptOutput).toEqual({
          binary: 'pass',
          script: 'pass'
        })
      }
    )
  }

  // verify.sh refuses an entry's shape only when it is not a JSON object, so it
  // does not refuse a signed entry these rules refuse.
  const ONE_SHAPE_PER_RULE = [...new Set(ONE_RULE_SHAPES.map(([, , message]) => message))].map(
    (message) => ONE_RULE_SHAPES.find(([, , m]) => m === message)!
  )
  for (const [label, fields] of ONE_SHAPE_PER_RULE) {
    it.skipIf(!HAS_JQ || !HAS_OPENSSL)(
      `fails Package Verification on ${label}, which verify.sh still passes`,
      () => {
        const result = conformance({ method: undefined, ...fields }, MANIFEST_SCHEMA_VERSION)
        expect({ binary: result.binary, script: result.script }, result.scriptOutput).toEqual({
          binary: 'fail',
          script: 'pass'
        })
        expect(result.binaryFailures.map(({ name }) => name)).toContain('manifest chain')
      }
    )
  }
})
