import { useParams } from '@tanstack/react-router'
import { CaptureList } from '@renderer/components/captures/CaptureList'
import { CaptureViewer } from '@renderer/components/captures/CaptureViewer'

export function CapturesRoute() {
  const { caseId } = useParams({ from: '/cases/$caseId/captures' })

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      <div className="w-[30%] max-w-xs overflow-y-auto border-r border-border">
        <CaptureList caseId={caseId} />
      </div>
      <div className="flex flex-1 overflow-hidden">
        <CaptureViewer />
      </div>
    </div>
  )
}
