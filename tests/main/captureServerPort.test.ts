import { describe, it, expect } from 'vitest'
import { CAPTURE_SERVER_PORT } from '@shared/constants'
import { CAPTURE_SERVER_PORT_OVERRIDE, resolveCaptureServerPort } from '@main/captureServerPort'

// The Capture Server port override (#1882): read only in a run from source,
// so a second copy of Birdbrain can boot beside the first in the two-instance
// e2e spec, and never in a packaged build.
describe('resolveCaptureServerPort', () => {
  it('names the switch the e2e fixture sets', () => {
    expect(CAPTURE_SERVER_PORT_OVERRIDE).toBe('BIRDBRAIN_CAPTURE_SERVER_PORT')
  })

  it('returns the fixed port when the override is unset', () => {
    expect(resolveCaptureServerPort(undefined, true)).toBe(CAPTURE_SERVER_PORT)
  })

  it('honours the override in a run from source', () => {
    expect(resolveCaptureServerPort('19846', true)).toBe(19846)
    expect(resolveCaptureServerPort('1', true)).toBe(1)
    expect(resolveCaptureServerPort('65535', true)).toBe(65535)
  })

  it('ignores the override in a packaged run', () => {
    expect(resolveCaptureServerPort('19846', false)).toBe(CAPTURE_SERVER_PORT)
  })

  it.each([
    ['0', 'zero'],
    ['65536', 'one over the highest port'],
    ['-1', 'negative'],
    ['19846.0', 'a fraction'],
    [' 19846', 'leading whitespace'],
    ['19846 ', 'trailing whitespace'],
    ['port', 'not a number'],
    ['', 'empty']
  ])('falls back to the fixed port for %s (%s)', (value) => {
    expect(resolveCaptureServerPort(value, true)).toBe(CAPTURE_SERVER_PORT)
  })
})
