import { createHash } from 'crypto'
import { signEntryHash } from '@main/services/signingKey'
import { canonicalStringify } from '@shared/verify'
import { MANIFEST_SCHEMA_VERSION } from '@shared/constants'

// Appends to a manifest's JSONL text the entry a Birdbrain newer than this
// build would write (X25): a type this build has never heard of, stamped one
// schema version above the read ceiling, linked to the last line, hashed, and
// signed by the signing key currently initialised. That is every check the
// too-old verdict has to survive, so the chain verifies to the verifier-too-old
// outcome rather than to a broken one.
export function appendFutureEntry(jsonl: string, caseId: string): string {
  const lines = jsonl.split('\n').filter((line) => line.trim().length > 0)
  const last = JSON.parse(lines[lines.length - 1]) as { index: number; entryHash: string }
  const body = {
    type: 'annotation-burn',
    caseId,
    timestamp: '2026-09-27T12:00:00.000Z',
    operatorId: 'inst-newer',
    operatorName: 'Newer Build',
    toolVersion: '9.0.0',
    schemaVersion: MANIFEST_SCHEMA_VERSION + 1,
    index: last.index + 1,
    prevHash: last.entryHash
  }
  const entryHash = createHash('sha256').update(canonicalStringify(body)).digest('hex')
  const line = JSON.stringify({ ...body, entryHash, signature: signEntryHash(entryHash) })
  return [...lines, line].join('\n') + '\n'
}
