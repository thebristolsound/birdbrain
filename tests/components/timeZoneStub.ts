import { afterAll, beforeAll } from 'vitest'

// On a machine in UTC a local rendering and a UTC one print the same string, so a regression
// to local formatting passes there. A zone with a non-zero offset makes it fail.
export const NON_UTC_ZONE = 'America/Los_Angeles'

export function pinNonUtcTimeZone(): void {
  let saved: string | undefined
  beforeAll(() => {
    saved = process.env.TZ
    process.env.TZ = NON_UTC_ZONE
    // A runtime that ignored the change would leave every assertion below passing for the
    // wrong reason.
    if (new Date('2026-01-15T12:00:00.000Z').getTimezoneOffset() === 0) {
      throw new Error(`setting TZ=${NON_UTC_ZONE} did not change the process timezone`)
    }
  })
  afterAll(() => {
    if (saved === undefined) delete process.env.TZ
    else process.env.TZ = saved
  })
}
