import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { listExhibitsWithCaseIdPath, repairExhibitCaseIdPath } from '@main/services/db/exhibitRepo'
import {
  listStagingFilesWithCaseIdPath,
  repairStagingFileCaseIdPath
} from '@main/services/db/stagingRepo'
import { EXHIBIT_KIND_SUBDIRECTORIES, STAGING_SUBDIRECTORY } from '@main/services/captureStore'
import { getStorageRoot } from '@main/services/storage'
import { logger } from '@main/services/logger'
import { ident } from '@main/services/logSafe'

// Repairs the non-Capture Exhibit and pooled rows an archive import left with
// the bare Case id as their path before #1609 (#1610). That import still wrote
// each file under the kind's subdirectory as `<row id><ext>`, so the row is
// pointed at the one file there carrying its id, in the form the fixed
// `rerootPath` writes. With no such file, or several, the row is left and
// logged. Only the `path` column is written, and no file, hash or chain entry
// changes. An Exhibit row's update still fires the existing exhibits revision
// trigger, which advances the Case revision and writes a change-log row.
//
// Not in `migrations.ts` for the reason `exhibitBackfill.ts` gives: the
// storage root does not exist yet when migrations run. It needs no completion
// marker either, because a database with no such row costs two queries and
// writes nothing, so it runs on every launch, as the backfill does.

export interface ImportedPathRepairResult {
  repaired: number
  unrepaired: number
}

interface Candidate {
  caseId: string
  id: string
  subdirectory: string
  repair: (path: string) => boolean
  // `count` is absent when the directory could not be listed.
  report: (count: number | null, err?: unknown) => void
}

function filesCarryingId(dir: string, id: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(({ name }) => name === id || name.startsWith(`${id}.`))
    .filter((entry) => entry.isFile())
    .map(({ name }) => name)
}

export function runImportedPathRepair(): ImportedPathRepairResult {
  const root = getStorageRoot()
  const candidates: Candidate[] = [
    ...listExhibitsWithCaseIdPath().map(({ id, caseId, kind }) => ({
      caseId,
      id,
      subdirectory: EXHIBIT_KIND_SUBDIRECTORIES[kind] ?? '',
      repair: (path: string) => repairExhibitCaseIdPath(id, path),
      report: (count: number | null, err?: unknown) =>
        logger.warn(
          'exhibits',
          'exhibits.path_unrepaired',
          count === null ? { exhibitId: ident(id) } : { exhibitId: ident(id), count },
          err
        )
    })),
    ...listStagingFilesWithCaseIdPath().map(({ id, caseId }) => ({
      caseId,
      id,
      subdirectory: STAGING_SUBDIRECTORY,
      repair: (path: string) => repairStagingFileCaseIdPath(id, path),
      report: (count: number | null, err?: unknown) =>
        logger.warn(
          'staging',
          'staging.path_unrepaired',
          count === null ? { stagingId: ident(id) } : { stagingId: ident(id), count },
          err
        )
    }))
  ]

  const result: ImportedPathRepairResult = { repaired: 0, unrepaired: 0 }
  for (const { caseId, id, subdirectory, repair, report } of candidates) {
    let names: string[]
    // One unreadable directory must not stop the app opening or the other rows.
    try {
      names = filesCarryingId(join(root, caseId, subdirectory), id)
    } catch (err) {
      result.unrepaired += 1
      report(null, err)
      continue
    }
    if (names.length !== 1) {
      result.unrepaired += 1
      report(names.length)
      continue
    }
    const inCase = subdirectory ? `${subdirectory}/${names[0]}` : names[0]
    if (repair(`${caseId}/${inCase}`)) result.repaired += 1
  }
  return result
}
