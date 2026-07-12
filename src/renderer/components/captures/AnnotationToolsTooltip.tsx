import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { settingsQueryOptions, useSettingsMutations } from '@renderer/lib/api/settings'

const KEY = 'annotation-tools-always-live'

export function AnnotationToolsTooltip() {
  const [dismissed, setDismissed] = useState(false)
  const { data: settings } = useQuery(settingsQueryOptions)
  const { update } = useSettingsMutations()

  if (!settings) return null
  if (settings.tooltipsSeen[KEY]) return null
  if (dismissed) return null

  const handleDismiss = () => {
    setDismissed(true)
    update.mutate({
      tooltipsSeen: { ...settings.tooltipsSeen, [KEY]: true }
    })
  }

  return (
    <div
      role="status"
      className="pointer-events-auto absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-secondary shadow-md"
    >
      <div className="flex items-center gap-3">
        <span>
          Drawing tools are now always live — pick the cursor to navigate, pick a shape to draw.
        </span>
        <button
          type="button"
          aria-label="Dismiss tip"
          onClick={handleDismiss}
          className="rounded p-0.5 text-text-muted hover:bg-elevated hover:text-text-primary"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
