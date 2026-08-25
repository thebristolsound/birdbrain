import { useCallback, useEffect } from 'react'
import type { Capture } from '@shared/types'
import { notify } from '@renderer/lib/notify'

/**
 * Puts a capture's source URL on the clipboard.
 *
 * A plain function rather than a hook so the per-kind context-menu registry
 * (#701) can invoke it for whichever row was right-clicked, without mounting
 * anything per capture.
 */
export async function copyCaptureUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    notify.success('Copied URL')
  } catch (cause) {
    // A denied clipboard permission rejects, and saying nothing reads as
    // success — the operator would paste whatever was on the clipboard before
    // and never know the URL was not it.
    notify.error("Couldn't copy the URL to your clipboard", { cause })
  }
}

/**
 * The keyboard route for {@link copyCaptureUrl}, plus the callback the capture
 * actions menu invokes. Mount once per surface: the listener is on `window`,
 * so a second mount would copy twice.
 */
export function useCopyCaptureUrl(capture: Capture | null): () => void {
  const url = capture?.url

  const copyUrl = useCallback(() => {
    if (url) void copyCaptureUrl(url)
  }, [url])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.repeat || !url) return
      // Cmd on macOS, Ctrl elsewhere — the same pair every other accelerator in
      // the app accepts (useCommandPalette, useCaptureSelection). Shift and Alt
      // belong to other accelerators, so they must not fall through to this one.
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
      if (e.key !== 'c' && e.key !== 'C') return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      // Text the operator has selected on screen — a passage of the captured
      // page, a hash in the custody panel — is what they meant to copy. The URL
      // is only the fallback for the gesture that would otherwise copy nothing.
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) return
      e.preventDefault()
      void copyCaptureUrl(url)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [url])

  return copyUrl
}
