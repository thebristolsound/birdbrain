import { useQuery } from '@tanstack/react-query'
import { membersQueryOptions } from '@renderer/lib/api/sharing'
import { MemberCodeChip } from '@renderer/components/sharing/MemberCodeChip'
import { memberCount, sharedByLine } from '@renderer/components/sharing/memberModel'

export function SharedCaseLine({ caseId }: { caseId: string }) {
  const { data } = useQuery(membersQueryOptions(caseId))
  const self = data?.members.find((member) => member.installationId === data.installationId)
  const owner = data?.members.find((member) => member.role === 'owner')
  if (!data || !self || !owner) return null
  return (
    <div
      className="mb-3 flex items-center gap-1.5 text-[10px] text-text-muted"
      data-testid="shared-case-line"
    >
      <MemberCodeChip code={self.memberCode} hue="accent" size={14} />
      <span>{sharedByLine(owner.operatorName, memberCount(data.members))}</span>
    </div>
  )
}
