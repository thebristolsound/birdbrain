import { readFileSync, statSync } from 'fs'
import { extname } from 'path'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import { verifyCapture } from '@main/services/captureLifecycle'
import { defaultCaptureStore } from '@main/services/captureStore'
import { getCase } from '@main/services/db/caseRepo'
import { getExhibit } from '@main/services/db/exhibitRepo'
import { getCaseInventory, getManifestSnapshot, verifyExhibit } from '@main/services/exhibits'
import {
  MAX_IMAGE_BYTES,
  READ_ONLY,
  failure,
  json,
  page,
  pageInput,
  storedFilePath
} from '../results'

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}
const TEXT_TYPES = new Set(['.txt', '.md', '.csv', '.json', '.html', '.htm', '.xml', '.eml'])

export function registerCustodyTools(server: McpServer): void {
  server.registerTool(
    'list_exhibits',
    {
      description:
        "A Case's Exhibit inventory: every Capture and uploaded file with its Exhibit " +
        'Number, content hash and Derived Files, plus files still in the Staging Pool ' +
        '(not yet anchored in the manifest).',
      inputSchema: z.object({ caseId: z.string() }),
      annotations: READ_ONLY
    },
    ({ caseId }) => json(getCaseInventory(caseId))
  )

  server.registerTool(
    'get_exhibit_file',
    {
      description:
        'The stored file of a non-Capture Exhibit: images inline, text paged, anything ' +
        'else (PDF, archives) as its metadata and path on disk. Use the capture tools for ' +
        'a Capture Exhibit.',
      inputSchema: z.object({ exhibitId: z.string(), ...pageInput }),
      annotations: READ_ONLY
    },
    ({ exhibitId, offset, length }) => {
      const exhibit = getExhibit(exhibitId)
      if (!exhibit) return failure(`No Exhibit with id ${exhibitId}`)
      if (exhibit.kind === 'capture') {
        return failure(`Exhibit ${exhibitId} is a Capture; use get_capture_text or get_capture`)
      }
      if (!exhibit.path) return failure(`Exhibit ${exhibitId} records no stored file`)
      const path = storedFilePath(exhibit.path)
      const ext = extname(exhibit.name || exhibit.path).toLowerCase()
      const mimeType = IMAGE_TYPES[ext]
      if (mimeType && statSync(path).size <= MAX_IMAGE_BYTES) {
        return {
          content: [{ type: 'image', data: readFileSync(path).toString('base64'), mimeType }]
        }
      }
      if (TEXT_TYPES.has(ext)) {
        return json({ ...exhibit, ...page(readFileSync(path, 'utf-8'), offset, length) })
      }
      return json({ ...exhibit, absolutePath: path, inline: false })
    }
  )

  server.registerTool(
    'get_manifest',
    {
      description:
        "A Case's signed, hash-chained custody manifest: every entry, the chain verdict " +
        'and who signed each segment. The verdict "unsupported" means this build cannot ' +
        'read a newer entry, never tampering.',
      inputSchema: z.object({ caseId: z.string() }),
      annotations: READ_ONLY
    },
    // The id goes into a path, so only a Case the database holds reaches it.
    ({ caseId }) => {
      const found = getCase(caseId)
      if (!found) return failure(`No Case with id ${caseId}`)
      return json(getManifestSnapshot(found.id))
    }
  )

  server.registerTool(
    'verify_capture',
    {
      description:
        'Re-hash a Capture and check it against the signed manifest. Reports integrity ' +
        '(verified, tampered, missing, chain-broken, legacy, verifier-too-old) and trusted ' +
        'time (rfc3161, pending, none) as separate axes. Records nothing.',
      inputSchema: z.object({ captureId: z.string() }),
      annotations: READ_ONLY
    },
    async ({ captureId }) =>
      json(await verifyCapture(captureId, defaultCaptureStore, { record: false }))
  )

  server.registerTool(
    'verify_exhibit',
    {
      description:
        'Verify any Exhibit, including uploaded files and Derived Files, against the ' +
        'signed manifest. A Capture Exhibit carries the verify_capture result. Records ' +
        'nothing.',
      inputSchema: z.object({ caseId: z.string(), exhibitId: z.string() }),
      annotations: READ_ONLY
    },
    async ({ caseId, exhibitId }) =>
      json(await verifyExhibit(caseId, exhibitId, defaultCaptureStore, { record: false }))
  )
}
