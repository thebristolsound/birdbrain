import { useCallback } from 'react'
import type { Capture } from '@shared/types'
import { notify } from '@renderer/lib/notify'

/**
 * Puts a capture's SHA-256 on the clipboard, byte for byte as stored.
 *
 * The digest is the capture's content address: it is what `verify` compares
 * against and what an exported package records. A copy that lowercases, trims,
 * truncates or affixes it produces a string that will not match the evidence it
 * names, in a report or in court — so the stored value is written unchanged,
 * and no display formatting stands between the two.
 *
 * A plain function rather than a hook so the per-kind context-menu registry
 * (#701) can invoke it for whichever row was right-clicked, without mounting
 * anything per capture.
 */
export async function copyCaptureHash(hash: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(hash)
    notify.success('Copied SHA-256')
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
    if (hash) void copyCaptureHash(hash)
  }, [hash])
}
