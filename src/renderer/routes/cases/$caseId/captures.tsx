import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Camera } from 'lucide-react'
import { CaptureList } from '@renderer/components/captures/CaptureList'
import { CaptureViewer } from '@renderer/components/captures/CaptureViewer'
import { capturesQueryOptions } from '@renderer/lib/queries'
import { QueryState } from '@renderer/components/ui/query-state'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { LoadingState } from '@renderer/components/ui/loading-state'

export function CapturesRoute() {
  const { caseId } = useParams({ from: '/cases/$caseId/captures' })
  const query = useQuery(capturesQueryOptions(caseId))

  return (
    <QueryState
      query={query}
      isEmpty={(captures) => captures.length === 0}
      loading={<LoadingState label="Loading captures..." className="h-full" />}
      empty={
        <div className="flex h-full items-center justify-center p-8">
          <EmptyState
            icon={<Camera width={22} height={22} />}
            title="No captures yet"
            description="Connect the Birdbrain browser extension, then turn on Auto-Capture in the top bar. Pages you visit will appear here."
          />
        </div>
      }
    >
      {(captures) => (
        <div className="flex h-full flex-1 overflow-hidden">
          <CaptureList caseId={caseId} captures={captures} />
          <div className="flex flex-1 overflow-hidden">
            <CaptureViewer />
          </div>
        </div>
      )}
    </QueryState>
  )
}
