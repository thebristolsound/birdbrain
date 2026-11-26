import { notify } from '@renderer/lib/notify'

// Either hex case: case carries no meaning to a verifier, and an uppercase
// digest is still copied verbatim.
const SHA256_HEX = /^[0-9a-f]{64}$/i

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

// copyValue for a SHA-256. A stored value that cannot be one is still copied
// as stored, because refusing it would hide the storage defect; only the toast
// changes, so it does not vouch for a digest that is not one (#950). An empty
// value is not written at all, and says so rather than leaving the previous
// clipboard to be pasted as this digest (#945).
export async function copyDigest(value: string, label: string): Promise<void> {
  if (value === '') {
    notify.warn(`Nothing was copied: the stored ${label} is empty`)
    return
  }
  try {
    await navigator.clipboard.writeText(value)
    if (SHA256_HEX.test(value)) notify.success(`Copied ${label}`)
    else notify.warn(`Copied the stored ${label}, but it isn't a 64-character hex digest`)
  } catch (cause) {
    notify.error(`Couldn't copy the ${label} to your clipboard`, { cause })
  }
}
