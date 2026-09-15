import { notify } from '@renderer/lib/notify'

// Puts a value on the clipboard exactly as stored. A copy that trims or
// reformats a digest or a path produces a string that names nothing, so the
// stored value is written unchanged, and a denied clipboard is reported
// rather than read as success.
export async function copyValue(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    notify.success(`Copied ${label}`)
  } catch (cause) {
    notify.error(`Couldn't copy the ${label} to your clipboard`, { cause })
  }
}
