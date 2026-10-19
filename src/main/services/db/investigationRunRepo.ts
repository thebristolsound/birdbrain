import { rowStore, type Insert } from '@main/services/db/investigationRows'

// Run records (engine plan E1): local to the installation that ran them, never
// synced. Stored as written: insert and list, and the Case Archive collect and
// import pair. The status writes a run makes as it ends are CI-R's.

export interface InvestigationRun {
  id: string
  caseId: string
  startedFrom: string
  inquiry: string | null
  jointId: string | null
  status: string
  statusReason: string | null
  startGeneration: string
  startCounter: number
  startHeadIndex: number | null
  startHeadHash: string | null
  storedGeneration: string | null
  storedCounter: number | null
  storedHeadIndex: number | null
  storedHeadHash: string | null
  layers: string
  versions: string
  params: string
  counts: string | null
  startedAt: string
  endedAt: string | null
  operatorId: string
  operatorName: string
}

export interface InvestigationRunBasis {
  runId: string
  kind: string
  refId: string
  snapshot: string | null
  snapshotHash: string | null
}

export interface InvestigationRunCandidate {
  runId: string
  ord: number
  rule: string
  groupKey: string | null
  exhibitId: string
  contentHash: string
  field: string
  locator: string
  jointSpanId: string | null
  textCheck: string | null
  textBasis: string | null
  checkReason: string | null
}

export interface InvestigationRunProposal {
  runId: string
  jointId: string
  proposalHash: string
  created: number
}

const runs = rowStore<InvestigationRun>({
  table: 'investigation_runs',
  columns: [
    'id',
    'case_id',
    'started_from',
    'inquiry',
    'joint_id',
    'status',
    'status_reason',
    'start_generation',
    'start_counter',
    'start_head_index',
    'start_head_hash',
    'stored_generation',
    'stored_counter',
    'stored_head_index',
    'stored_head_hash',
    'layers',
    'versions',
    'params',
    'counts',
    'started_at',
    'ended_at',
    'operator_id',
    'operator_name'
  ],
  references: ['joint_id'],
  scope: 'case',
  synced: false
})

// The child tables name their run by `run_id`, which the import remaps with
// the run, as `note_tags` follows its Note.
const basis = rowStore<InvestigationRunBasis>({
  table: 'investigation_run_basis',
  columns: ['run_id', 'kind', 'ref_id', 'snapshot', 'snapshot_hash'],
  references: ['run_id', 'ref_id'],
  scope: 'run',
  synced: false
})

const candidates = rowStore<InvestigationRunCandidate>({
  table: 'investigation_run_candidates',
  columns: [
    'run_id',
    'ord',
    'rule',
    'group_key',
    'exhibit_id',
    'content_hash',
    'field',
    'locator',
    'joint_span_id',
    'text_check',
    'text_basis',
    'check_reason'
  ],
  references: ['run_id', 'exhibit_id', 'joint_span_id'],
  scope: 'run',
  synced: false
})

const proposals = rowStore<InvestigationRunProposal>({
  table: 'investigation_run_proposals',
  columns: ['run_id', 'joint_id', 'proposal_hash', 'created'],
  references: ['run_id', 'joint_id'],
  scope: 'run',
  synced: false
})

export const insertInvestigationRun = (
  fields: Insert<
    InvestigationRun,
    | 'caseId'
    | 'startedFrom'
    | 'status'
    | 'startGeneration'
    | 'startCounter'
    | 'layers'
    | 'versions'
    | 'params'
    | 'startedAt'
    | 'operatorId'
    | 'operatorName'
  >
): InvestigationRun => runs.insert(fields)
export const listInvestigationRuns = runs.list
export const collectInvestigationRunsForCase = runs.collect
export const importInvestigationRunRows = runs.importRows

export const insertInvestigationRunBasis = (
  fields: Insert<InvestigationRunBasis, 'runId' | 'kind' | 'refId'>
): InvestigationRunBasis => basis.insert(fields)
export const listInvestigationRunBasis = basis.list
export const collectInvestigationRunBasisForCase = basis.collect
export const importInvestigationRunBasisRows = basis.importRows

export const insertInvestigationRunCandidate = (
  fields: Insert<
    InvestigationRunCandidate,
    'runId' | 'ord' | 'rule' | 'exhibitId' | 'contentHash' | 'field' | 'locator'
  >
): InvestigationRunCandidate => candidates.insert(fields)
export const listInvestigationRunCandidates = candidates.list
export const collectInvestigationRunCandidatesForCase = candidates.collect
export const importInvestigationRunCandidateRows = candidates.importRows

export const insertInvestigationRunProposal = (
  fields: Insert<InvestigationRunProposal, 'runId' | 'jointId' | 'proposalHash' | 'created'>
): InvestigationRunProposal => proposals.insert(fields)
export const listInvestigationRunProposals = proposals.list
export const collectInvestigationRunProposalsForCase = proposals.collect
export const importInvestigationRunProposalRows = proposals.importRows
