import { useAppStore } from '@renderer/stores/appStore'

export function ConnectionStatus() {
  const { connectedToExtension, sessionActive, activeCaseId } = useAppStore()

  if (sessionActive) {
    return (
      <div className="flex items-center gap-2 rounded-full bg-red-950/50 px-3 py-1">
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
        <span className="text-xs font-medium text-red-400">Recording</span>
      </div>
    )
  }

  if (connectedToExtension) {
    return (
      <div className="flex items-center gap-2 rounded-full bg-green-950/50 px-3 py-1">
        <span className="h-2 w-2 rounded-full bg-green-500" />
        <span className="text-xs font-medium text-green-400">Connected</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-full bg-neutral-800 px-3 py-1">
      <span className="h-2 w-2 rounded-full bg-neutral-500" />
      <span className="text-xs font-medium text-neutral-500">Waiting for extension</span>
    </div>
  )
}
