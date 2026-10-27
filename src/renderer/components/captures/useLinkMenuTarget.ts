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
 * `recapture:enqueue` queue every background Capture uses. That queue refuses the
 * same literal local addresses the menu does, from the same classification, and the
 * hidden render refuses a main-frame redirect to one (#1726). The job also names
 * `captureId`, the viewed Capture, and the link address as the menu read it (ADR-0040).
 */
export function useLinkMenuTarget(
  caseId: string,
  captureId: string
): (hit: LinkHit) => LinkMenuTarget {
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
          captureLink: () => {
            // Main checks the source's entry and bytes when the job runs, so a refusal then
            // arrives as an activity event after the queued notice (ADR-0040). Listening
            // starts before the request, so a refusal that beats the reply is not missed.
            // The job is matched by its source and address, not the event's `url`, which a
            // redirect into an excluded address replaces with the final address.
            let warned = false
            const stop = window.birdbrain.onCaptureActivity((event) => {
              const { type, source, linkedFrom, skipReason, error } = event
              if (source !== 'recapture' || type === 'received') return
              if (linkedFrom?.captureId !== captureId || linkedFrom.linkHref !== linkUrl) return
              stop()
              if (type === 'stored') return
              warned = true
              notify.warn(`Link not captured: ${skipReason ?? error ?? 'refused'}`)
            })
            mutate(
              { urls: [linkUrl], linkedFrom: { captureId, linkHref: linkUrl } },
              {
                onSuccess: ({ accepted, rejected }) => {
                  if (accepted > 0) {
                    notify.success('Link capture queued', {
                      description: `${linkUrl}. Its source is checked before the link renders.`
                    })
                    return
                  }
                  stop()
                  if (!warned) notify.warn(`Link not captured: ${rejected[0]?.reason ?? 'refused'}`)
                },
                onError: () => stop()
              }
            )
          }
        }
      }
    },
    [captures, selectCapture, mutate, captureId]
  )
}
