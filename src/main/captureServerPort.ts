// The Capture Server's port, and the one environment override that can change it.
//
// The override exists for the two-instance Shared Case e2e test (#1882): a second copy of
// Birdbrain on the same machine cannot bind the fixed port, and boot refuses to continue
// without a Capture Server. It is read only when the app runs unpackaged, as the window-size
// override is (windowSize.ts): an installed build always listens where the Chrome extension
// looks, whatever a stray variable in the operator's environment says. Nothing evidentiary
// depends on the port: the server behind it hashes and stores a Capture the same way on any.
//
// Kept out of index.ts so it is reachable by tests, for the reason windowSize.ts gives.

import { CAPTURE_SERVER_PORT } from '@shared/constants'

export const CAPTURE_SERVER_PORT_OVERRIDE = 'BIRDBRAIN_CAPTURE_SERVER_PORT'

const PORT_PATTERN = /^\d{1,5}$/
const MAX_PORT = 65535

/**
 * The port the Capture Server listens on: `CAPTURE_SERVER_PORT`, or the override when the
 * build is unpackaged and the value is a whole number from 1 to 65535. Anything else, a
 * packaged build included, is the fixed port.
 */
export function resolveCaptureServerPort(
  value: string | undefined,
  allowOverride: boolean
): number {
  if (!allowOverride || value === undefined || !PORT_PATTERN.test(value)) return CAPTURE_SERVER_PORT
  const port = Number.parseInt(value, 10)
  if (port < 1 || port > MAX_PORT) return CAPTURE_SERVER_PORT
  return port
}
