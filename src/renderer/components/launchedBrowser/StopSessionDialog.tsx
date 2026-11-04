import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle
} from '@renderer/components/ui'
import { casesQueryOptions } from '@renderer/lib/api/cases'
import {
  endLaunchedBrowserSession,
  launchedBrowserName,
  launchedBrowserStatusQueryOptions
} from '@renderer/lib/api/launchedBrowser'
import { useAppStore } from '@renderer/stores/appStore'
import { InfoTip } from '@renderer/components/launchedBrowser/InfoTip'

// The stop confirmation (`1i`), mounted once at the root: the panel's Stop… and the Capture
// Session switch open it while a launched browser is open. It asks only then, because only then
// does stopping close a browser.
export function StopSessionDialog() {
  const requested = useAppStore((s) => s.stopConfirmOpen)
  const setOpen = useAppStore((s) => s.setStopConfirmOpen)
  const { data: status } = useQuery(launchedBrowserStatusQueryOptions)
  const { data: cases = [] } = useQuery(casesQueryOptions)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState('')

  const browser = status?.state === 'open' ? status.browser : null
  const open = requested && (browser !== null || stopping)

  // A browser that closes or starts closing while the Operator reads this takes the question
  // with it.
  const gone = status !== undefined && browser === null && !stopping
  useEffect(() => {
    if (requested && gone) setOpen(false)
  }, [requested, gone, setOpen])

  function close() {
    if (stopping) return
    setError('')
    setOpen(false)
  }

  async function stop() {
    setStopping(true)
    setError('')
    try {
      await endLaunchedBrowserSession()
      setOpen(false)
    } catch {
      setError('The Capture Session could not be stopped.')
    } finally {
      setStopping(false)
    }
  }

  const name = browser ? launchedBrowserName(browser.label) : ''
  const caseName = cases.find(({ id }) => id === browser?.caseId)?.name ?? ''

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      {open && (
        <DialogContent onClose={close} className="max-w-sm rounded-md p-3 text-xs">
          <div className="flex items-center gap-1.5">
            <DialogTitle>Stop the Capture Session?</DialogTitle>
            <InfoTip
              text={
                `The extension records into the same Capture Session in ${caseName}, so ` +
                'stopping ends it there too. Birdbrain deletes the throwaway browser profile.'
              }
            />
          </div>
          <DialogDescription className="mt-0.5 text-xs">{name} will close.</DialogDescription>
          {error && (
            <p role="alert" className="mt-1.5 text-[11px] text-danger-fg">
              {error}
            </p>
          )}
          <DialogFooter className="mt-2 gap-1.5">
            <Button variant="outline" disabled={stopping} onClick={close}>
              Keep running
            </Button>
            <Button
              className="font-semibold text-accent-foreground"
              disabled={stopping}
              onClick={() => void stop()}
            >
              {stopping ? 'Stopping…' : 'Stop and close browser'}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
