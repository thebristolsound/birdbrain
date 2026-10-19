import {
  rowStore,
  SYNC_COLUMNS,
  type Insert,
  type SyncColumns
} from '@main/services/db/investigationRows'

// Subjects, Joints and the spans they cite (engine plan E1), stored as written:
// insert and list, and the Case Archive collect and import pair.

export interface Subject extends SyncColumns {
  id: string
  caseId: string
  name: string
  kind: string
  boundExhibitId: string | null
  boundIdentifier: string | null
  createdByRunId: string | null
  keptAt: string | null
  createdAt: string
  operatorId: string
  operatorName: string
}

export interface Joint extends SyncColumns {
  id: string
  caseId: string
  claim: string
  claimHash: string
  subjectAId: string
  subjectBId: string | null
  producerKind: string
  producer: string
  producerVersion: string
  identityHash: string
  fromNoteId: string | null
  fromNotePassage: string | null
  fromSpanDecisionId: string | null
  createdByRunId: string | null
  createdAt: string
}

export interface JointSpan extends SyncColumns {
  id: string
  caseId: string
  jointId: string
  side: string | null
  exhibitId: string
  contentHash: string
  representation: string
  field: string
  locator: string
  value: string
  spanKey: string
  reading: string
  createdByRunId: string | null
  createdAt: string
}

export interface SubjectSpan extends SyncColumns {
  id: string
  caseId: string
  subjectId: string
  exhibitId: string
  contentHash: string
  representation: string
  field: string
  locator: string
  value: string
  spanKey: string
  createdByRunId: string | null
  createdAt: string
}

const subjects = rowStore<Subject>({
  table: 'subjects',
  columns: [
    'id',
    'case_id',
    'name',
    'kind',
    'bound_exhibit_id',
    'bound_identifier',
    'created_by_run_id',
    'kept_at',
    'created_at',
    'operator_id',
    'operator_name',
    ...SYNC_COLUMNS
  ],
  references: ['bound_exhibit_id', 'created_by_run_id'],
  scope: 'case',
  synced: true
})

const joints = rowStore<Joint>({
  table: 'joints',
  columns: [
    'id',
    'case_id',
    'claim',
    'claim_hash',
    'subject_a_id',
    'subject_b_id',
    'producer_kind',
    'producer',
    'producer_version',
    'identity_hash',
    'from_note_id',
    'from_note_passage',
    'from_span_decision_id',
    'created_by_run_id',
    'created_at',
    ...SYNC_COLUMNS
  ],
  references: [
    'subject_a_id',
    'subject_b_id',
    'from_note_id',
    'from_span_decision_id',
    'created_by_run_id'
  ],
  scope: 'case',
  synced: true
})

const jointSpans = rowStore<JointSpan>({
  table: 'joint_spans',
  columns: [
    'id',
    'case_id',
    'joint_id',
    'side',
    'exhibit_id',
    'content_hash',
    'representation',
    'field',
    'locator',
    'value',
    'span_key',
    'reading',
    'created_by_run_id',
    'created_at',
    ...SYNC_COLUMNS
  ],
  references: ['joint_id', 'exhibit_id', 'created_by_run_id'],
  scope: 'case',
  synced: true
})

const subjectSpans = rowStore<SubjectSpan>({
  table: 'subject_spans',
  columns: [
    'id',
    'case_id',
    'subject_id',
    'exhibit_id',
    'content_hash',
    'representation',
    'field',
    'locator',
    'value',
    'span_key',
    'created_by_run_id',
    'created_at',
    ...SYNC_COLUMNS
  ],
  references: ['subject_id', 'exhibit_id', 'created_by_run_id'],
  scope: 'case',
  synced: true
})

export const insertSubject = (
  fields: Insert<Subject, 'caseId' | 'name' | 'kind' | 'createdAt' | 'operatorId' | 'operatorName'>
): Subject => subjects.insert(fields)
export const listSubjects = subjects.list
export const collectSubjectsForCase = subjects.collect
export const importSubjectRows = subjects.importRows

export const insertJoint = (
  fields: Insert<
    Joint,
    | 'caseId'
    | 'claim'
    | 'claimHash'
    | 'subjectAId'
    | 'producerKind'
    | 'producer'
    | 'producerVersion'
    | 'identityHash'
    | 'createdAt'
  >
): Joint => joints.insert(fields)
export const listJoints = joints.list
export const collectJointsForCase = joints.collect
export const importJointRows = joints.importRows

export const insertJointSpan = (
  fields: Insert<
    JointSpan,
    | 'caseId'
    | 'jointId'
    | 'exhibitId'
    | 'contentHash'
    | 'representation'
    | 'field'
    | 'locator'
    | 'value'
    | 'spanKey'
    | 'reading'
    | 'createdAt'
  >
): JointSpan => jointSpans.insert(fields)
export const listJointSpans = jointSpans.list
export const collectJointSpansForCase = jointSpans.collect
export const importJointSpanRows = jointSpans.importRows

export const insertSubjectSpan = (
  fields: Insert<
    SubjectSpan,
    | 'caseId'
    | 'subjectId'
    | 'exhibitId'
    | 'contentHash'
    | 'representation'
    | 'field'
    | 'locator'
    | 'value'
    | 'spanKey'
    | 'createdAt'
  >
): SubjectSpan => subjectSpans.insert(fields)
export const listSubjectSpans = subjectSpans.list
export const collectSubjectSpansForCase = subjectSpans.collect
export const importSubjectSpanRows = subjectSpans.importRows
