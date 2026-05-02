import type { Capture } from '@shared/types'

interface Props {
  capture: Capture
  caseId: string
}

export function ForensicsTab({ capture, caseId }: Props) {
  void caseId
  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      <div className="text-xs text-text-muted">{capture.id}</div>
    </div>
  )
}
