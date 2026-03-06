import { useCaptures } from '@renderer/hooks/useCaptures'
import { useAppStore } from '@renderer/stores/appStore'
import { CaptureItem } from './CaptureItem'

interface CaptureListProps {
  caseId: string
}

export function CaptureList({ caseId }: CaptureListProps) {
  const { captures } = useCaptures(caseId)
  const { selectedCaptureId, selectCapture } = useAppStore()

  return (
    <div className="flex flex-col">
      <div className="px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Captures ({captures.length})
        </span>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {captures.map((cap) => (
          <CaptureItem
            key={cap.id}
            capture={cap}
            isSelected={cap.id === selectedCaptureId}
            onClick={() => selectCapture(cap.id)}
          />
        ))}
        {captures.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-neutral-600">No captures yet</div>
        )}
      </div>
    </div>
  )
}
