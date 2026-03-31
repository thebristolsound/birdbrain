import { useParams } from '@tanstack/react-router'
import { CaptureList } from '@renderer/components/captures/CaptureList'
import { CaptureViewer } from '@renderer/components/captures/CaptureViewer'

export function CapturesRoute() {
  const { caseId } = useParams({ strict: false })

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-[30%] overflow-y-auto">
        <CaptureList caseId={caseId!} />
      </div>
      <div className="flex-1 overflow-y-auto">
        <CaptureViewer />
      </div>
    </div>
  )
}
