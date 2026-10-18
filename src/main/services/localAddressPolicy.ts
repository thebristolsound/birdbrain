import { app } from 'electron'
import { localAddressKind, localAddressLabel } from '@shared/localAddress'

// A background capture refuses a link or redirect that lands on the Operator's own machine
// or network (#1726). The recapture queue checks the link and the final URL, and the hidden
// renderer checks each redirect hop before Chromium follows it.

// The recapture e2e specs serve their fixture pages on 127.0.0.1. Only an unpackaged build
// reads this switch, so no installed copy of Birdbrain can turn it on, and it never admits a
// private or link-local address. The unit tests run with no Electron app, so they see it off.
export const E2E_LOOPBACK_SWITCH = 'BIRDBRAIN_E2E_ALLOW_LOOPBACK'

function loopbackAllowedForTests(): boolean {
  return app?.isPackaged === false && process.env[E2E_LOOPBACK_SWITCH] === '1'
}

/**
 * The class of address a background capture refuses to visit at `url`, as in "a private
 * address", or null when it may visit it. The classification is the one the viewer's
 * Capture link uses, so the two refuse the same addresses.
 */
export function refusedAddressClass(url: string): string | null {
  const kind = localAddressKind(url)
  if (!kind) return null
  if ((kind === 'loopback' || kind === 'this-computer') && loopbackAllowedForTests()) return null
  return localAddressLabel(kind)
}

/**
 * Thrown by a renderer that refused a redirect hop. The job ends as a refusal with this
 * message, not as a failure, and nothing from the address is rendered or stored.
 */
export class RefusedAddressError extends Error {
  constructor(addressClass: string) {
    super(`Redirects to ${addressClass}`)
    this.name = 'RefusedAddressError'
  }
}
