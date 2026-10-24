import { useQuery } from '@tanstack/react-query'
import type { Capture, SharingMembers } from '@shared/types'
import type { CaseManifestSnapshot } from '@shared/manifestSnapshot'
import { membersQueryOptions } from '@renderer/lib/api/sharing'
import { caseQueryOptions } from '@renderer/lib/api/cases'
import { manifestSnapshotQueryOptions } from '@renderer/lib/api/exhibits'
import { capturedBy, hueFor } from '@renderer/components/sharing/memberModel'

export interface CaptureSharing {
  members?: SharingMembers
  snapshot?: CaseManifestSnapshot
}

export function useCaptureSharing(caseId: string, enabled: boolean): CaptureSharing {
  const { data: caseRecord } = useQuery(caseQueryOptions(caseId))
  const shared = enabled || !!caseRecord?.sharedAt
  const { data: members } = useQuery({ ...membersQueryOptions(caseId), enabled: shared })
  const { data: snapshot } = useQuery({ ...manifestSnapshotQueryOptions(caseId), enabled: shared })
  return { members, snapshot }
}

export function captureAttribution(capture: Capture, members: SharingMembers | undefined) {
  const code = capture.exhibitCitation?.match(/^([A-Z0-9]{1,3})-/)?.[1]
  // The app hides the prefix for a roster of one; the local roster still identifies its author.
  const member = code
    ? members?.members.find((entry) => entry.memberCode === code)
    : /^\d+$/.test(capture.exhibitCitation ?? '') && members?.members.length === 1
      ? members.members.find((entry) => entry.installationId === members.installationId)
      : undefined
  if (!members || !member) return null
  const isSelf = member.installationId === members.installationId
  return {
    member,
    isSelf,
    hue: hueFor(members.members, members.installationId, member.installationId),
    title: capturedBy(isSelf ? null : member.operatorName, member.memberCode)
  }
}
