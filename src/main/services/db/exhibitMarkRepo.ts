import { getDb } from '@main/services/db/core'
import {
  rowStore,
  SYNC_COLUMNS,
  type Insert,
  type SyncColumns
} from '@main/services/db/investigationRows'

// The Operator's marks on Exhibits (engine plan E1): Source Class, copy marks,
// Withheld from analysis flags and Own Identifiers, stored as written: insert
// and list, and the Case Archive collect and import pair. Each new row lists in
// `replaces` the rows it supersedes (E2); this module stores the list and
// computes no heads from it, apart from the eligibility view's reading below.

export interface SourceClassMark extends SyncColumns {
  id: string
  caseId: string
  exhibitId: string
  value: string
  reason: string | null
  replaces: string[]
  actedAt: string
  operatorId: string
  operatorName: string
}

export interface CopyMark extends SyncColumns {
  id: string
  caseId: string
  copyExhibitId: string
  originalExhibitId: string
  // 1: the pair counts as one source; 0: the mark undone.
  marked: number
  reason: string | null
  replaces: string[]
  actedAt: string
  operatorId: string
  operatorName: string
}

export interface WithheldFlag extends SyncColumns {
  id: string
  caseId: string
  exhibitId: string
  // Null: the row's author holds the flag.
  holderInstallationId: string | null
  action: string
  replaces: string[]
  actedAt: string
  operatorId: string
  operatorName: string
}

export interface OwnIdentifier extends SyncColumns {
  id: string
  caseId: string
  // Null: the row's author holds the entry.
  holderInstallationId: string | null
  kind: string
  platform: string | null
  value: string
  // This installation's Persona; never synced and never in a Case Archive.
  personaId: string | null
  marked: number
  replaces: string[]
  actedAt: string
  operatorId: string
  operatorName: string
}

const sourceClassMarks = rowStore<SourceClassMark>({
  table: 'source_class_marks',
  columns: [
    'id',
    'case_id',
    'exhibit_id',
    'value',
    'reason',
    'replaces',
    'acted_at',
    'operator_id',
    'operator_name',
    ...SYNC_COLUMNS
  ],
  references: ['exhibit_id'],
  scope: 'case',
  synced: true
})

const copyMarks = rowStore<CopyMark>({
  table: 'copy_marks',
  columns: [
    'id',
    'case_id',
    'copy_exhibit_id',
    'original_exhibit_id',
    'marked',
    'reason',
    'replaces',
    'acted_at',
    'operator_id',
    'operator_name',
    ...SYNC_COLUMNS
  ],
  references: ['copy_exhibit_id', 'original_exhibit_id'],
  scope: 'case',
  synced: true
})

const withheldFlags = rowStore<WithheldFlag>({
  table: 'withheld_flags',
  columns: [
    'id',
    'case_id',
    'exhibit_id',
    'holder_installation_id',
    'action',
    'replaces',
    'acted_at',
    'operator_id',
    'operator_name',
    ...SYNC_COLUMNS
  ],
  references: ['exhibit_id'],
  scope: 'case',
  synced: true
})

const ownIdentifiers = rowStore<OwnIdentifier>({
  table: 'own_identifiers',
  columns: [
    'id',
    'case_id',
    'holder_installation_id',
    'kind',
    'platform',
    'value',
    'persona_id',
    'marked',
    'replaces',
    'acted_at',
    'operator_id',
    'operator_name',
    ...SYNC_COLUMNS
  ],
  references: [],
  scope: 'case',
  synced: true
})

type MarkRequired = 'caseId' | 'actedAt' | 'operatorId' | 'operatorName'

export const insertSourceClassMark = (
  fields: Insert<SourceClassMark, MarkRequired | 'exhibitId' | 'value'>
): SourceClassMark => sourceClassMarks.insert(fields)
export const listSourceClassMarks = sourceClassMarks.list
export const collectSourceClassMarksForCase = sourceClassMarks.collect
export const importSourceClassMarkRows = sourceClassMarks.importRows

export const insertCopyMark = (
  fields: Insert<CopyMark, MarkRequired | 'copyExhibitId' | 'originalExhibitId' | 'marked'>
): CopyMark => copyMarks.insert(fields)
export const listCopyMarks = copyMarks.list
export const collectCopyMarksForCase = copyMarks.collect
export const importCopyMarkRows = copyMarks.importRows

export const insertWithheldFlag = (
  fields: Insert<WithheldFlag, MarkRequired | 'exhibitId' | 'action'>
): WithheldFlag => withheldFlags.insert(fields)
export const listWithheldFlags = withheldFlags.list
export const collectWithheldFlagsForCase = withheldFlags.collect
export const importWithheldFlagRows = withheldFlags.importRows

export const insertOwnIdentifier = (
  fields: Insert<OwnIdentifier, MarkRequired | 'kind' | 'value' | 'marked'>
): OwnIdentifier => ownIdentifiers.insert(fields)
export const listOwnIdentifiers = ownIdentifiers.list
export const collectOwnIdentifiersForCase = ownIdentifiers.collect
export const importOwnIdentifierRows = ownIdentifiers.importRows

/**
 * The Case's Exhibits that analysis may not read: those the eligibility view
 * (`analysis_eligible_exhibits`, migration 40) leaves out because a live
 * withheld head is `set`, whoever holds it. The view holds ADR-0042's rule, so
 * this reads it rather than repeating it.
 */
export function withheldExhibitIds(caseId: string): string[] {
  return (
    getDb()
      .prepare(
        `SELECT id FROM exhibits WHERE case_id = ?
            AND id NOT IN (SELECT id FROM analysis_eligible_exhibits WHERE case_id = ?)
          ORDER BY id`
      )
      .all(caseId, caseId) as Array<{ id: string }>
  ).map(({ id }) => id)
}
