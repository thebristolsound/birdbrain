import { runInNewContext } from 'vm'

const REGEX_TIMEOUT_MS = 200

export function safeRegexTest(pattern: string, flags: string, text: string): boolean {
  try {
    return runInNewContext(
      'new RegExp(pattern, flags).test(text)',
      { pattern, flags, text },
      { timeout: REGEX_TIMEOUT_MS }
    ) as boolean
  } catch {
    return false
  }
}
