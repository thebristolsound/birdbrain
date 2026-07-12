// Transitional re-export barrel over the per-aggregate repos in ./db/ — keeps
// consumers compiling until they import the repos directly (repo-split Task 3).
export {
  initDatabase,
  getDb,
  closeDatabase,
  LATEST_SCHEMA_VERSION,
  withTransaction
} from '@main/services/db/core'
export * from '@main/services/db/caseRepo'
export * from '@main/services/db/captureRepo'
export * from '@main/services/db/tagRepo'
export * from '@main/services/db/selectorRepo'
export * from '@main/services/db/noteRepo'
export * from '@main/services/db/archiveRefRepo'
export * from '@main/services/db/extractedDataRepo'
