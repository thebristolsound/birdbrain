import {
  rowStore,
  SYNC_COLUMNS,
  type Insert,
  type SyncColumns
} from '@main/services/db/investigationRows'

// The Operator's decisions on Joints and spans (engine plan E1), stored as
// written: insert and list, and the Case Archive collect and import pair. Each
// decision is a new row that lists in `replaces` the author's earlier head it
// replaces (E2); this module stores the list and decides nothing from it.

export interface JointDecision extends SyncColumns {
  id: string
  caseId: string
  jointId: string
  decision: string
  reason: string | null
  assumptions: string | null
  confidence: string | null
  alternatives: string | null
  basisRunId: string | null
  basisAsOf: string | null
  basisProposalHash: string | null
  replaces: string[]
  decidedAt: string
  operatorId: string
  operatorName: string
}

export interface SpanDecision extends SyncColumns {
  id: string
  caseId: string
  // Exactly one of the two is set.
  jointSpanId: string | null
  subjectSpanId: string | null
  action: string
  chosenSubjectId: string | null
  reason: string | null
  replaces: string[]
  decidedAt: string
  operatorId: string
  operatorName: string
}

const jointDecisions = rowStore<JointDecision>({
  table: 'joint_decisions',
  columns: [
    'id',
    'case_id',
    'joint_id',
    'decision',
    'reason',
    'assumptions',
    'confidence',
    'alternatives',
    'basis_run_id',
    'basis_as_of',
    'basis_proposal_hash',
    'replaces',
    'decided_at',
    'operator_id',
    'operator_name',
    ...SYNC_COLUMNS
  ],
  references: ['joint_id', 'basis_run_id'],
  scope: 'case',
  synced: true
})

const spanDecisions = rowStore<SpanDecision>({
  table: 'span_decisions',
  columns: [
    'id',
    'case_id',
    'joint_span_id',
    'subject_span_id',
    'action',
    'chosen_subject_id',
    'reason',
    'replaces',
    'decided_at',
    'operator_id',
    'operator_name',
    ...SYNC_COLUMNS
  ],
  references: ['joint_span_id', 'subject_span_id', 'chosen_subject_id'],
  scope: 'case',
  synced: true
})

export const insertJointDecision = (
  fields: Insert<
    JointDecision,
    'caseId' | 'jointId' | 'decision' | 'decidedAt' | 'operatorId' | 'operatorName'
  >
): JointDecision => jointDecisions.insert(fields)
export const listJointDecisions = jointDecisions.list
export const collectJointDecisionsForCase = jointDecisions.collect
export const importJointDecisionRows = jointDecisions.importRows

export const insertSpanDecision = (
  fields: Insert<SpanDecision, 'caseId' | 'action' | 'decidedAt' | 'operatorId' | 'operatorName'>
): SpanDecision => spanDecisions.insert(fields)
export const listSpanDecisions = spanDecisions.list
export const collectSpanDecisionsForCase = spanDecisions.collect
export const importSpanDecisionRows = spanDecisions.importRows
