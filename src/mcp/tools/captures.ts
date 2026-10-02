import { statSync, readFileSync } from 'fs'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import * as annotations from '@main/services/annotations'
import { defaultCaptureStore } from '@main/services/captureStore'
import * as captureRepo from '@main/services/db/captureRepo'
import * as selectorRepo from '@main/services/db/selectorRepo'
import * as tagRepo from '@main/services/db/tagRepo'
import * as waybackRefRepo from '@main/services/db/waybackRefRepo'
import { readExtractionHtml } from '@main/services/extraction/extractionSource'
import type { Capture } from '@shared/types'
import {
  MAX_IMAGE_BYTES,
  READ_ONLY,
  failure,
  json,
  page,
  pageInput,
  storedFilePath
} from '../results'

// The fields a list needs to choose and cite a Capture; get_capture has the rest.
function summary(capture: Capture, favorites: Set<string>) {
  const { id, exhibitNumber, exhibitCitation, url, title, timestamp, hash, method } = capture
  return {
    id,
    exhibitNumber,
    exhibitCitation,
    url,
    title,
    capturedAt: timestamp,
    contentHash: hash,
    method,
    httpStatus: capture.httpStatus,
    lastVerifiedStatus: capture.lastVerifiedStatus,
    trustedTimeStatus: capture.trustedTimeStatus,
    favorite: favorites.has(id)
  }
}

export function registerCaptureTools(server: McpServer): void {
  server.registerTool(
    'list_captures',
    {
      description:
        'List the Captures in a Case. Optional filters narrow to Captures carrying any of ' +
        'the given Tags, matching any of the given selectors, or marked favourite.',
      inputSchema: z.object({
        caseId: z.string(),
        tagIds: z.array(z.string()).optional(),
        selectorIds: z.array(z.string()).optional(),
        favoritesOnly: z.boolean().default(false)
      }),
      annotations: READ_ONLY
    },
    ({ caseId, tagIds, selectorIds, favoritesOnly }) => {
      const favorites = new Set(captureRepo.listFavorites(caseId))
      let captures = captureRepo.listCaptures(caseId)
      if (tagIds?.length) {
        const tagged = new Set(tagRepo.getCapturesWithAnyTag(caseId, tagIds))
        captures = captures.filter((c) => tagged.has(c.id))
      }
      if (selectorIds?.length) {
        const matched = new Set(selectorRepo.getCapturesMatchingSelectors(caseId, selectorIds))
        captures = captures.filter((c) => matched.has(c.id))
      }
      if (favoritesOnly) captures = captures.filter((c) => favorites.has(c.id))
      return json(captures.map((c) => summary(c, favorites)))
    }
  )

  server.registerTool(
    'get_capture',
    {
      description:
        'Everything the app shows for one Capture: acquisition record (headers, TLS chain, ' +
        'operator, tool versions, manifest position), Tags, matching selectors, favourite, ' +
        'annotations and pinned Wayback snapshots. Page content is read with ' +
        'get_capture_text, get_capture_html and get_capture_screenshot.',
      inputSchema: z.object({ captureId: z.string() }),
      annotations: READ_ONLY
    },
    ({ captureId }) => {
      const capture = captureRepo.getCapture(captureId)
      if (!capture) return failure(`No Capture with id ${captureId}`)
      return json({
        ...capture,
        favorite: captureRepo.isFavorite(captureId),
        tags: tagRepo.getTagsForCapture(captureId),
        matchingSelectors: selectorRepo.getCaptureMatchingSelectors(captureId),
        annotations: annotations.getAnnotations(captureId),
        waybackRefs: waybackRefRepo.listWaybackRefs(captureId)
      })
    }
  )

  server.registerTool(
    'get_capture_text',
    {
      description:
        "A Capture's extracted page text, paged. Use nextOffset to read on; null means " +
        'the end.',
      inputSchema: z.object({ captureId: z.string(), ...pageInput }),
      annotations: READ_ONLY
    },
    ({ captureId, offset, length }) => {
      const capture = captureRepo.getCapture(captureId)
      if (!capture) return failure(`No Capture with id ${captureId}`)
      const text = defaultCaptureStore.readArtifact(capture.caseId, captureId, 'txt')
      if (!text) return failure(`Capture ${captureId} has no extracted text`)
      return json({ captureId, ...page(text.toString('utf-8'), offset, length) })
    }
  )

  server.registerTool(
    'get_capture_html',
    {
      description:
        "The page's HTML as captured (decoded from the MHTML archive), paged. Use " +
        'nextOffset to read on; null means the end.',
      inputSchema: z.object({ captureId: z.string(), ...pageInput }),
      annotations: READ_ONLY
    },
    ({ captureId, offset, length }) => {
      const capture = captureRepo.getCapture(captureId)
      if (!capture) return failure(`No Capture with id ${captureId}`)
      const html = readExtractionHtml(capture.caseId, captureId)
      if (html === null) return failure(`Capture ${captureId} has no stored page`)
      return json({ captureId, ...page(html, offset, length) })
    }
  )

  server.registerTool(
    'get_capture_screenshot',
    {
      description:
        "A Capture's full-page screenshot as an image. One too large to return inline " +
        'comes back as its size and path on disk.',
      inputSchema: z.object({ captureId: z.string() }),
      annotations: READ_ONLY
    },
    ({ captureId }) => {
      const capture = captureRepo.getCapture(captureId)
      if (!capture) return failure(`No Capture with id ${captureId}`)
      if (!capture.screenshotPath) return failure(`Capture ${captureId} has no screenshot`)
      const path = storedFilePath(capture.screenshotPath)
      const sizeBytes = statSync(path).size
      if (sizeBytes > MAX_IMAGE_BYTES) {
        return json({ captureId, sizeBytes, path, inline: false })
      }
      return {
        content: [
          { type: 'image', data: readFileSync(path).toString('base64'), mimeType: 'image/png' }
        ]
      }
    }
  )

  server.registerTool(
    'search_captures',
    {
      description:
        'Full-text search over the page text of every Capture in a Case. Uses SQLite FTS5 ' +
        'syntax; quote a phrase containing punctuation.',
      inputSchema: z.object({ caseId: z.string(), query: z.string().min(1) }),
      annotations: READ_ONLY
    },
    ({ caseId, query }) => {
      const favorites = new Set(captureRepo.listFavorites(caseId))
      return json(captureRepo.searchCaptures(query, caseId).map((c) => summary(c, favorites)))
    }
  )
}
