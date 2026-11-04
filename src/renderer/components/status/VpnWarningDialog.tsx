import type { KeyboardEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui'
import { settleVpnWarning, useVpnWarningStore } from '@renderer/lib/vpnWarning'

// The one VPN warning (ADR-0032 rules 2 and 3), mounted once at the root. It never blocks:
// Continue always lets the contact go ahead.
export function VpnWarningDialog() {
  const open = useVpnWarningStore((s) => s.open)
  const request = useVpnWarningStore((s) => s.request)
  const navigate = useNavigate()

  function setUpProxy() {
    settleVpnWarning('set-up-proxy')
    void navigate({ to: '/settings', search: { section: 'egress' } })
  }

  // Escape answers this warning only, not a dialog open beneath it such as the paste-URLs
  // box: both listen on the window, and they skip a key that was already handled.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    settleVpnWarning('dismiss')
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && settleVpnWarning('dismiss')}>
      <DialogContent
        onClose={() => settleVpnWarning('dismiss')}
        onKeyDown={onKeyDown}
        data-testid="vpn-warning-dialog"
        className="max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>Birdbrain did not see a VPN</DialogTitle>
          <DialogDescription>
            The Egress is Direct, so Birdbrain contacts sites from this computer&rsquo;s own
            connection. Birdbrain looks for a VPN on this computer&rsquo;s route only, so a VPN on
            your router or network is not seen.
          </DialogDescription>
          {request?.occasion === 'session' && (
            <DialogDescription data-testid="vpn-warning-session">
              Birdbrain sees this computer&rsquo;s network path, not your browser&rsquo;s. A VPN set
              up only in your browser is not seen.
            </DialogDescription>
          )}
          {request && !request.canMute && (
            <DialogDescription data-testid="vpn-warning-no-network">
              Birdbrain could not read this network&rsquo;s router address, so it cannot stop
              warning on this network.
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter className="flex-wrap">
          <Button variant="outline" data-testid="vpn-warning-proxy" onClick={setUpProxy}>
            Set up a proxy
          </Button>
          {request?.canMute && (
            <Button
              variant="outline"
              data-testid="vpn-warning-mute"
              onClick={() => settleVpnWarning('mute-network')}
            >
              Stop warning on this network
            </Button>
          )}
          <Button data-testid="vpn-warning-continue" onClick={() => settleVpnWarning('continue')}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
