import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  AddSubjectParams,
  CaseRevision,
  ChooseSubjectParams,
  DecideJointParams,
  DecideSpanParams,
  KeepSubjectParams,
  MarkOwnIdentifierParams,
  RunRequest,
  SetCopyMarkParams,
  SetSourceClassParams,
  SetWithheldParams,
  UnmarkOwnIdentifierParams
} from '@shared/investigation'
import { queryKeys } from '@renderer/lib/api/keys'

// The Case investigation reads and writes (engine plan, E10). Until the engine exists the main
// process answers them from the fake engine, in unpackaged builds only.

export const investigationRevisionQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.investigationRevision(caseId),
    queryFn: () => window.birdbrain.investigation.getRevision(caseId),
    enabled: !!caseId
  })

export const investigationViewQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.investigationView(caseId),
    queryFn: () => window.birdbrain.investigation.getView(caseId),
    enabled: !!caseId
  })

export const investigationSpanQueryOptions = (caseId: string, spanId: string) =>
  queryOptions({
    queryKey: queryKeys.investigationSpan(caseId, spanId),
    queryFn: () => window.birdbrain.investigation.getSpan(caseId, spanId),
    enabled: !!caseId && !!spanId
  })

export const investigationCheckQueryOptions = (caseId: string, spanId: string) =>
  queryOptions({
    queryKey: queryKeys.investigationCheck(caseId, spanId),
    queryFn: () => window.birdbrain.investigation.checkSpan(caseId, spanId),
    enabled: !!caseId && !!spanId
  })

export const investigationChangesQueryOptions = (caseId: string, runId: string) =>
  queryOptions({
    queryKey: queryKeys.investigationChanges(caseId, runId),
    queryFn: () => window.birdbrain.investigation.getChanges(caseId, runId),
    enabled: !!caseId && !!runId
  })

export const ownIdentifiersQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.ownIdentifiers(caseId),
    queryFn: () => window.birdbrain.investigation.listOwnIdentifiers(caseId),
    enabled: !!caseId
  })

// The hook supplies the Case id. Distributes over a union, as `Omit` alone would collapse it.
type WithoutCase<T> = T extends unknown ? Omit<T, 'caseId'> : never

export function useInvestigationMutations(caseId: string) {
  const queryClient = useQueryClient()

  // Every write returns the Case's new revision. The view, its spans, the changes since a run and
  // the Own Identifier list all derive from Case state, so each is read again.
  const afterWrite = (revision: CaseRevision) => {
    queryClient.setQueryData(queryKeys.investigationRevision(caseId), revision)
    queryClient.invalidateQueries({ queryKey: queryKeys.investigationView(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.investigationSpans(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.investigationChangesAll(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.ownIdentifiers(caseId) })
  }

  const write = <P>(
    action: string,
    call: (params: P & { caseId: string }) => Promise<CaseRevision>
  ) => ({
    mutationFn: (params: WithoutCase<P>) => call({ ...params, caseId } as P & { caseId: string }),
    onSuccess: afterWrite,
    meta: { action }
  })

  const api = () => window.birdbrain.investigation

  return {
    // A run's outcome arrives on its progress events, not here.
    startRun: useMutation({
      mutationFn: (request: WithoutCase<RunRequest>) =>
        api().startRun({ ...request, caseId } as RunRequest),
      meta: { action: 'start an investigation run' }
    }),
    cancelRun: useMutation({
      mutationFn: (runId: string) => api().cancelRun(caseId, runId),
      meta: { action: 'cancel the investigation run' }
    }),
    decideJoint: useMutation(
      write<DecideJointParams>('record a Joint decision', (p) => api().decideJoint(p))
    ),
    decideSpan: useMutation(
      write<DecideSpanParams>('record a span decision', (p) => api().decideSpan(p))
    ),
    chooseSubject: useMutation(
      write<ChooseSubjectParams>('place a same-name span', (p) => api().chooseSubject(p))
    ),
    addSubject: useMutation(write<AddSubjectParams>('add a Subject', (p) => api().addSubject(p))),
    keepSubject: useMutation(
      write<KeepSubjectParams>('keep a Subject', (p) => api().keepSubject(p))
    ),
    setSourceClass: useMutation(
      write<SetSourceClassParams>('set a Source Class', (p) => api().setSourceClass(p))
    ),
    setCopyMark: useMutation(
      write<SetCopyMarkParams>('change a copy mark', (p) => api().setCopyMark(p))
    ),
    setWithheld: useMutation(
      write<SetWithheldParams>('change Withheld from analysis', (p) => api().setWithheld(p))
    ),
    markOwnIdentifier: useMutation(
      write<MarkOwnIdentifierParams>('mark an Own Identifier', (p) => api().markOwnIdentifier(p))
    ),
    unmarkOwnIdentifier: useMutation(
      write<UnmarkOwnIdentifierParams>('unmark an Own Identifier', (p) =>
        api().unmarkOwnIdentifier(p)
      )
    )
  }
}
