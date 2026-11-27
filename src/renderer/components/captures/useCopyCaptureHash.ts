import { useCallback } from 'react'
import type { Capture } from '@shared/types'
import { copyDigest } from '@renderer/components/data/copy'

/**
 * Puts a capture's SHA-256 on the clipboard, byte for byte as stored.
 *
 * The digest is the capture's content address: it is what `verify` compares
 * against and what an exported package records. A copy that lowercases, trims,
 * truncates or affixes it produces a string that will not match the evidence it
 * names, in a report or in court — so the stored value is written unchanged,
 * and no display formatting stands between the two.
 *
 * An empty or malformed stored value is handled as `copyDigest` states.
 *
 * A plain function rather than a hook so the per-kind context-menu registry
 * (#701) can invoke it for whichever row was right-clicked, without mounting
 * anything per capture.
 */
export function copyCaptureHash(hash: string): Promise<void> {
  return copyDigest(hash, 'SHA-256')
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
