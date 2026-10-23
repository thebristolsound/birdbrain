import { createHash } from 'crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { insertDerivedFile } from '@main/services/db/derivedFileRepo'
import { appendManifestEntry, packageHash } from '@main/services/manifest'
import { getStorageRoot } from '@main/services/storage'
import { createStoredZip } from '@main/services/zip'
import { readStoredZip } from '@main/services/zipRead'

// Derived Files in a Case Archive (#1813), for tests that need no sharp: a
// `derivation` entry signed by hand over arbitrary bytes, and the archive edits
// that build an older archive or a hostile one whose header still verifies.

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

export interface SignedDerivedFile {
  outputPath: string
  outputHash: string
  index: number
}

// Signs a `derivation` entry for `parentExhibitId` on the Case's own chain.
// The bytes are written at `outputPath` and a row recorded for them unless the
// test says otherwise, which is what the thumbnail backfill leaves behind.
export function signDerivedFile(params: {
  caseId: string
  parentExhibitId: string
  parentContentHash: string
  bytes: Buffer
  outputPath?: string
  derivation?: string
  writeFile?: boolean
  recordRow?: boolean
}): SignedDerivedFile {
  const {
    caseId,
    parentExhibitId,
    parentContentHash,
    bytes,
    outputPath = `${caseId}/${parentExhibitId}_thumb.jpg`,
    derivation = 'thumbnail',
    writeFile = true,
    recordRow = true
  } = params
  const outputHash = sha256(bytes)
  if (writeFile) {
    const abs = join(getStorageRoot(), ...outputPath.split('/'))
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, bytes)
  }
  const timestamp = '2026-10-01T09:00:00.000Z'
  const { index } = appendManifestEntry(join(getStorageRoot(), caseId), {
    type: 'derivation',
    caseId,
    parentExhibitId,
    parentContentHash,
    derivation,
    derivationToolVersion: '0.1.0-derive',
    outputHash,
    outputPath,
    timestamp,
    operatorId: 'op-1',
    operatorName: 'Test Operator',
    toolVersion: '0.1.0'
  })
  if (recordRow) {
    insertDerivedFile({
      exhibitId: parentExhibitId,
      derivation,
      toolVersion: '0.1.0-derive',
      contentHash: outputHash,
      path: outputPath,
      createdAt: timestamp,
      manifestSeq: index
    })
  }
  return { outputPath, outputHash, index }
}

// Rewrites an archive's entries, then repairs its header so the artifact
// index and packageHash describe what the zip now holds. Only a signed hash can
// catch an edit made this way.
export function rewriteArchive(
  archivePath: string,
  edit: (entries: Map<string, Buffer>, header: Record<string, unknown>) => void
): void {
  const entries = readStoredZip(readFileSync(archivePath))
  const header = JSON.parse(entries.get('package.json')!.toString('utf-8')) as Record<
    string,
    unknown
  >
  edit(entries, header)
  entries.delete('package.json')
  const artifacts = [...entries].map(([path, data]) => ({
    path,
    sha256: sha256(data),
    sizeBytes: data.length
  }))
  header.artifacts = artifacts
  header.packageHash = packageHash(artifacts)
  const zip = [
    { name: 'package.json', data: Buffer.from(JSON.stringify(header, null, 2)) },
    ...[...entries].map(([name, data]) => ({ name, data }))
  ]
  writeFileSync(archivePath, createStoredZip(zip))
}

export const DERIVED_ENTRY_PREFIX = 'files/derived/'
export const ID_MAP_ENTRY_PREFIX = 'import-id-maps/'

// What a Birdbrain at Case Archive schema 11 wrote: no id map entries, and no
// Derived File whose signed parent is not a row the archive holds, which only
// a carried id map can anchor (#1017).
export function downgradeToVersion11(archivePath: string): void {
  rewriteArchive(archivePath, (entries, header) => {
    const data = JSON.parse(entries.get('data.json')!.toString('utf-8')) as {
      exhibits?: Array<{ id: string }>
    }
    const rows = new Set((data.exhibits ?? []).map(({ id }) => id))
    const derivations = (entries.get('manifest.jsonl') ?? Buffer.alloc(0))
      .toString('utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, string>)
      .filter((entry) => entry.type === 'derivation')
    for (const name of [...entries.keys()]) {
      if (name.startsWith(ID_MAP_ENTRY_PREFIX)) entries.delete(name)
      if (!name.startsWith(DERIVED_ENTRY_PREFIX)) continue
      const inCase = name.slice(DERIVED_ENTRY_PREFIX.length)
      const anchored = derivations.some(
        (entry) =>
          entry.outputPath.split('/').slice(1).join('/') === inCase &&
          rows.has(entry.parentExhibitId)
      )
      if (!anchored) entries.delete(name)
    }
    header.schemaVersion = 11
  })
}

// What a Birdbrain at Case Archive schema 10 wrote: the same archive with no
// Derived File entries.
export function downgradeToVersion10(archivePath: string): void {
  downgradeToVersion11(archivePath)
  rewriteArchive(archivePath, (entries, header) => {
    for (const name of [...entries.keys()]) {
      if (name.startsWith(DERIVED_ENTRY_PREFIX)) entries.delete(name)
    }
    header.schemaVersion = 10
  })
}
