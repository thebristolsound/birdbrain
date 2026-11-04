import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LaunchedBrowserLeftover } from '@shared/types'
import { Button } from '@renderer/components/ui'
import { leftoverBrowsersQueryOptions } from '@renderer/lib/api/launchedBrowser'
import { InfoTip } from '@renderer/components/launchedBrowser/InfoTip'

function profileName({ label, profile }: LaunchedBrowserLeftover): string {
  return profile === 'session'
    ? `${label} on a throwaway browser profile`
    : `${label} on a Persona's browser profile`
}

// State 13 (`1p`, `2f`), at startup as the spec's failure table raises it. A launched browser's
// connection ends with the run that launched it, so Birdbrain asks the Operator to close one
// left from an earlier run. A new launch takes a fresh profile, so the notice refuses nothing.
export function LeftoverBrowserNotice() {
  const { data: leftovers, isFetching, refetch } = useQuery(leftoverBrowsersQueryOptions)
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || !leftovers?.length) return null

  const [first] = leftovers
  const single = leftovers.length === 1
  const names = leftovers.map(profileName).join('; ')

  return (
    <div
      role="status"
      className="fixed right-4 top-14 z-40 w-[340px] rounded border border-l-[3px] border-border border-l-warning-fg bg-card px-2.5 py-[7px] text-xs shadow-[var(--shadow-overlay)]"
    >
      <div className="flex items-center gap-1.5">
        <span className="font-semibold text-text-primary">
          {single
            ? 'An old launched browser is still open'
            : `${leftovers.length} old launched browsers are still open`}
        </span>
        <InfoTip
          text={
            single
              ? `${profileName(first)}, from an earlier run of Birdbrain. Birdbrain cannot ` +
                'reconnect to it and is not recording it.'
              : 'Each is from an earlier run of Birdbrain. Birdbrain cannot reconnect to them ' +
                'and is not recording them.'
          }
        />
      </div>
      <p className="text-text-muted">
        {names}. Close {single ? 'that browser' : 'those browsers'}, then select Check again.
      </p>
      <div className="mt-1.5 flex gap-1.5">
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
          Check again
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}
