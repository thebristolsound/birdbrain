import { useCallback } from 'react'
import type { Capture } from '@shared/types'
import { notify } from '@renderer/lib/notify'

// Either hex case: case carries no meaning to a verifier, and an uppercase
// digest is still copied verbatim.
const SHA256_HEX = /^[0-9a-f]{64}$/i

/**
 * Puts a capture's SHA-256 on the clipboard, byte for byte as stored.
 *
 * The digest is the capture's content address: it is what `verify` compares
 * against and what an exported package records. A copy that lowercases, trims,
 * truncates or affixes it produces a string that will not match the evidence it
 * names, in a report or in court — so the stored value is written unchanged,
 * and no display formatting stands between the two.
 *
 * A stored value that cannot be a SHA-256 is still copied as stored, because
 * refusing it would hide the storage defect; only the toast changes, so it does
 * not vouch for a digest that is not one (#950). An empty value is not written
 * at all, and says so rather than leaving the previous clipboard to be pasted
 * as this capture's digest (#945).
 *
 * A plain function rather than a hook so the per-kind context-menu registry
 * (#701) can invoke it for whichever row was right-clicked, without mounting
 * anything per capture.
 */
export async function copyCaptureHash(hash: string): Promise<void> {
  if (hash === '') {
    notify.warn('Nothing was copied: the stored SHA-256 is empty')
    return
  }
  try {
    await navigator.clipboard.writeText(hash)
    if (SHA256_HEX.test(hash)) notify.success('Copied SHA-256')
    else notify.warn("Copied the stored SHA-256, but it isn't a 64-character hex digest")
  } catch (cause) {
    // A denied clipboard permission rejects, and saying nothing reads as
    // success — the operator would paste whatever was on the clipboard before
    // and never know the digest was not it.
    notify.error("Couldn't copy the SHA-256 to your clipboard", { cause })
  }
}

/**
 * The callback the capture actions menu invokes, bound to the selected capture.
 *
 * No keyboard accelerator, unlike its copy-URL sibling: the mock gives Copy
 * SHA-256 no key hint, Ctrl/Cmd+C already belongs to Copy URL, and the menu item
 * is the inline route ruling R5 asks for.
 */
export function useCopyCaptureHash(capture: Capture | null): () => void {
  const hash = capture?.hash

  return useCallback(() => {
    if (hash !== undefined) void copyCaptureHash(hash)
  }, [hash])
}
