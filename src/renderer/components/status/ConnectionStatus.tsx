import { useAppStore } from '@renderer/stores/appStore'

export function ConnectionStatus() {
  const connectedToExtension = useAppStore((s) => s.connectedToExtension)
  const sessionActive = useAppStore((s) => s.sessionActive)

  if (sessionActive) {
    return null
  }

  if (connectedToExtension) {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        <span className="text-[11px] font-medium text-emerald-400">Connected</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-border-strong bg-elevated px-2.5 py-1">
      <span className="h-1.5 w-1.5 rounded-full bg-text-muted" />
      <span className="text-[11px] font-medium text-text-muted">Waiting for extension</span>
    </div>
  )
}
