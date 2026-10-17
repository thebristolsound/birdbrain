// CDP gives times as plain numbers, and every request `wallTime` step 0 recorded carries a
// fraction of a second. The signed entry holds no fractional number (plan D2), so every time
// leaves this package as an ISO 8601 string. A value that is not a time throws rather than
// becoming a wrong date.

const finite = (value: unknown, name: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${name} is not a time: ${String(value)}`)
  }
  return value
}

export const isoFromEpochSeconds = (seconds: number): string =>
  new Date(finite(seconds, 'seconds') * 1000).toISOString()

export const isoFromEpochMilliseconds = (milliseconds: number): string =>
  new Date(finite(milliseconds, 'milliseconds')).toISOString()
