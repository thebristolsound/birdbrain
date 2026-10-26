import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { capturesQueryOptions } from '@renderer/lib/api/captures'
import { useRecaptureMutations } from '@renderer/lib/api/recapture'
import { waybackLinkLookupQueryOptions } from '@renderer/lib/api/wayback'
import { useAppStore } from '@renderer/stores/appStore'
import { notify } from '@renderer/lib/notify'
import { copyValue } from '@renderer/components/data/copy'
import type { LinkMenuTarget } from '@renderer/components/contextmenu/entityMenu'
import type { GuestLinkHit } from '@renderer/components/captures/guestLink'
import { isWebHref } from '@renderer/components/captures/linksTabModel'
import { openSnapshot } from '@renderer/components/captures/linkWayback'
import {
  closestLinkSnapshot,
  linkLookupSummary
} from '@renderer/components/captures/waybackLinkModel'
import { captureLinkBlockReason } from '@shared/localAddress'
import { resolveCaptureForUrl } from '@shared/urlCanonicalize'

export type LinkHit = Pick<GuestLinkHit, 'linkUrl' | 'linkText' | 'imageUrl' | 'selectionText'>

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Builds the `link` menu target for a hit in the stored page of Capture `captureId`, in
 * `caseId` (#1708). Capture link files into that Case, never the Active Case, through the
 * same `recapture:enqueue` queue every background Capture uses. That queue refuses the
 * same local addresses the menu does, from the same classification, and the hidden render
 * refuses a main-frame redirect to one (#1726). Look up in Wayback fills the cache the
 * Links tab's cells read (#1737); with `toastWayback` the answer is also a toast, for the
 * Page tab, which has no cell to show it in.
 */
export function useLinkMenuTarget(
  caseId: string,
  captureId: string,
  { toastWayback = false }: { toastWayback?: boolean } = {}
): (hit: LinkHit) => LinkMenuTarget {
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))
  const selectCapture = useAppStore((s) => s.selectCapture)
  const { enqueue } = useRecaptureMutations(caseId)
  const { mutate } = enqueue
  const queryClient = useQueryClient()
  const pageCapturedAt = captures.find(({ id }) => id === captureId)?.timestamp ?? ''

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
        isWebLink: isWebHref(linkUrl),
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
            ),
          lookUpInWayback: () => {
            queryClient.fetchQuery(waybackLinkLookupQueryOptions(captureId, linkUrl)).then(
              (result) => {
                if (!toastWayback) return
                const closest = closestLinkSnapshot(result)
                const summary = linkLookupSummary(result, pageCapturedAt)
                if (!closest) {
                  notify.info(`archive.org: ${summary.toLowerCase()} of this link`)
                  return
                }
                notify.success(`archive.org: ${summary}`, {
                  description: linkUrl,
                  action: {
                    label: 'Open at archive.org',
                    onClick: () => openSnapshot(closest.snapshotUrl)
                  }
                })
              },
              (cause: unknown) => {
                // The Links tab's cell shows the failure; the Page tab has only the toast.
                if (toastWayback) {
                  notify.error(`Wayback lookup failed: ${messageOf(cause)}`, { cause })
                }
              }
            )
          }
        }
      }
    },
    [captures, selectCapture, mutate, queryClient, captureId, toastWayback, pageCapturedAt]
  )
}
