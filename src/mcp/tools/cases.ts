import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import * as activityRepo from '@main/services/db/activityRepo'
import * as caseRepo from '@main/services/db/caseRepo'
import * as captureRepo from '@main/services/db/captureRepo'
import * as extractedDataRepo from '@main/services/db/extractedDataRepo'
import * as noteRepo from '@main/services/db/noteRepo'
import * as selectorRepo from '@main/services/db/selectorRepo'
import * as tagRepo from '@main/services/db/tagRepo'
import { READ_ONLY, failure, json } from '../results'

export function registerCaseTools(server: McpServer): void {
  server.registerTool(
    'list_cases',
    {
      description: 'List every Case with its Capture count.',
      annotations: READ_ONLY
    },
    () => {
      const counts = captureRepo.getCaptureCountsByCase()
      return json(caseRepo.listCases().map((c) => ({ ...c, captureCount: counts[c.id] ?? 0 })))
    }
  )

  server.registerTool(
    'get_case',
    {
      description:
        'One Case with the counts its overview shows: Captures, Notes, Tags in use, ' +
        'extracted data items and selector coverage.',
      inputSchema: z.object({ caseId: z.string() }),
      annotations: READ_ONLY
    },
    ({ caseId }) => {
      const found = caseRepo.getCase(caseId)
      if (!found) return failure(`No Case with id ${caseId}`)
      return json({
        ...found,
        captureCount: captureRepo.getCaptureCountsByCase()[caseId] ?? 0,
        noteCount: noteRepo.getNoteCount(caseId),
        tagsInUse: Object.keys(tagRepo.getTagUsageCountsForCase(caseId)).length,
        extractedDataCount: extractedDataRepo.getExtractedDataCountForCase(caseId),
        selectorCoverage: selectorRepo.getSelectorCoverage(caseId)
      })
    }
  )

  server.registerTool(
    'recent_activity',
    {
      description: 'The most recent Captures and Note edits across all Cases, newest first.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
      annotations: READ_ONLY
    },
    ({ limit }) => json(activityRepo.listRecentActivity(limit))
  )
}
