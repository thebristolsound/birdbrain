import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { capturesQueryOptions } from '@renderer/lib/api/captures'
import { useRecaptureMutations } from '@renderer/lib/api/recapture'
import { useAppStore } from '@renderer/stores/appStore'
import { notify } from '@renderer/lib/notify'
import { copyValue } from '@renderer/components/data/copy'
import type { LinkMenuTarget } from '@renderer/components/contextmenu/entityMenu'
import { captureLinkBlockReason, type GuestLinkHit } from '@renderer/components/captures/guestLink'
import { resolveCaptureForUrl } from '@shared/urlCanonicalize'

export type LinkHit = Pick<GuestLinkHit, 'linkUrl' | 'linkText' | 'imageUrl' | 'selectionText'>

/**
 * Builds the `link` menu target for a hit in a stored page of `caseId` (#1708).
 * Capture link files into that Case, never the Active Case, through the same
 * `recapture:enqueue` queue every background Capture uses; its URL check in main is
 * the backstop behind the menu's own refusal.
 */
export function useLinkMenuTarget(caseId: string): (hit: LinkHit) => LinkMenuTarget {
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))
  const selectCapture = useAppStore((s) => s.selectCapture)
  const { enqueue } = useRecaptureMutations(caseId)
  const { mutate } = enqueue

  return useCallback(
    (hit: LinkHit): LinkMenuTarget => {
      const { linkUrl, linkText, imageUrl, selectionText } = hit
      const capturedCopy = linkUrl ? resolveCaptureForUrl(linkUrl, captures) : null
      return {
        kind: 'link',
        linkUrl,
        linkText,
        imageUrl,
        selectionText,
        hasCapturedCopy: capturedCopy !== null,
        captureBlockedReason: captureLinkBlockReason(linkUrl),
        actions: {
          copyLinkAddress: () => void copyValue(linkUrl, 'link address'),
          copyLinkText: () => void copyValue(linkText, 'link text'),
          copyImageAddress: () => void copyValue(imageUrl, 'image address'),
          copyText: () => void copyValue(selectionText, 'text'),
          openCapturedCopy: () => {
            if (capturedCopy) selectCapture(capturedCopy.id)
          },
          captureLink: () =>
            mutate(
              { urls: [linkUrl] },
              {
                onSuccess: ({ accepted, rejected }) => {
                  if (accepted > 0) notify.success('Link capture queued', { description: linkUrl })
                  else notify.warn(`Link not captured: ${rejected[0]?.reason ?? 'refused'}`)
                }
              }
            )
        }
      }
    },
    [captures, selectCapture, mutate]
  )
}
