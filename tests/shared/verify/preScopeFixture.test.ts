import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import { verifyManifestChainText } from '@shared/verify'

// Backward-verification known-answer test (#398). fixtures/pre-scope-package is
// a REAL evidence package frozen from the tree as it stood before #398 shipped
// scoped export entries and export-entry.json: its chain holds two captures, a
// timestamp, a deletion and a pre-scope `export` entry, and the package
// contains no export-entry.json. The bytes are committed and must never be
// regenerated — the whole point is that packages already in the world keep
// verifying, and that is provable only against bytes today's code did not
// write.
//
// If the frozen-digest assertions fail, the fixture bytes changed (regenerated,
// or EOL-mangled on checkout — .gitattributes marks the directory -text to
// prevent the latter). If only the PASS assertions fail, a schema or verifier
// change broke backward verification: the usual culprit is a new
// ManifestExportEntrySchema key that is required or carries a .default(),
// either of which breaks every legacy export entry (#398 intake ruling).

const FIXTURE_DIR = join(__dirname, 'fixtures', 'pre-scope-package')

const FROZEN_MANIFEST_SHA256 =
  '395461f2bf42d5f9354df90f31f5412b58e94dfd9bc83390c022a1dcc2c2da5c'
const FROZEN_PUBLIC_KEY_SHA256 =
  'd7383d2314547ffa17e70517d42c5d8559e52c0a90fb5fbac1a98968069249b6'

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

describe('frozen pre-scope fixture package', () => {
  it('is byte-for-byte the frozen pre-#398 bytes', () => {
    expect(sha256(readFileSync(join(FIXTURE_DIR, 'manifest.jsonl')))).toBe(FROZEN_MANIFEST_SHA256)
    expect(sha256(readFileSync(join(FIXTURE_DIR, 'signing-public-key.pem')))).toBe(
      FROZEN_PUBLIC_KEY_SHA256
    )
  })

  it('holds the pre-scope shape this test exists to pin', () => {
    const entries = readFileSync(join(FIXTURE_DIR, 'manifest.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    const exportEntries = entries.filter((e) => e.type === 'export')
    expect(exportEntries).toHaveLength(1)
    // Pre-scope: the legacy export entry carries neither of the #398 keys.
    expect('scope' in exportEntries[0]).toBe(false)
    expect('captureIds' in exportEntries[0]).toBe(false)
    expect(entries.some((e) => e.type === 'deletion')).toBe(true)
  })

  it('chain-verifies against its own bundled public key', () => {
    const result = verifyManifestChainText(
      readFileSync(join(FIXTURE_DIR, 'manifest.jsonl'), 'utf-8'),
      { publicKeyPem: readFileSync(join(FIXTURE_DIR, 'signing-public-key.pem'), 'utf-8') }
    )
    expect(result.valid, `${result.reason} (at index ${result.brokenAt})`).toBe(true)
  })

  it('PASSes full package verification unchanged', () => {
    const result = verifyEvidencePackage(FIXTURE_DIR)
    expect(result.pass, JSON.stringify(result.checks, null, 2)).toBe(true)
    expect(result.checks.some((c) => c.status === 'fail')).toBe(false)
  })
})
