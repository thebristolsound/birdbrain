import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Capture, SharingMembers } from '@shared/types'
import type { CaseManifestSnapshot } from '@shared/manifestSnapshot'
import { membersQueryOptions } from '@renderer/lib/api/sharing'
import { caseQueryOptions } from '@renderer/lib/api/cases'
import { manifestSnapshotQueryOptions } from '@renderer/lib/api/exhibits'
import {
  capturedBy,
  exclusionsOf,
  hueFor,
  type ExclusionFact
} from '@renderer/components/sharing/memberModel'

export interface CaptureSharing {
  members?: SharingMembers
  snapshot?: CaseManifestSnapshot
  exclusions?: ReadonlyMap<string, ExclusionFact>
}

export function useCaptureSharing(caseId: string, enabled: boolean): CaptureSharing {
  const { data: caseRecord } = useQuery(caseQueryOptions(caseId))
  const shared = enabled || !!caseRecord?.sharedAt
  const { data: members } = useQuery({ ...membersQueryOptions(caseId), enabled: shared })
  const { data: snapshot } = useQuery({ ...manifestSnapshotQueryOptions(caseId), enabled: shared })
  const exclusions = useMemo(() => exclusionsOf(snapshot), [snapshot])
  return { members, snapshot, exclusions }
}

export function captureAttribution(capture: Capture, members: SharingMembers | undefined) {
  if (!members || !capture.operatorId) return null
  const member = members.members.find((entry) => entry.installationId === capture.operatorId)
  if (!member) return null
  const code = capture.exhibitCitation?.match(/^([A-Z0-9]{1,3})-/)?.[1]
  // Forks retain original author IDs and codes; a current roster may reuse a code.
  const matchesCitation = code
    ? member.memberCode === code
    : /^\d+$/.test(capture.exhibitCitation ?? '') &&
      members.members.length === 1 &&
      member.installationId === members.installationId
  if (!matchesCitation) return null
  const isSelf = member.installationId === members.installationId
  return {
    member,
    isSelf,
    hue: hueFor(members.members, members.installationId, member.installationId),
    title: capturedBy(isSelf ? null : member.operatorName, member.memberCode)
  }
}
