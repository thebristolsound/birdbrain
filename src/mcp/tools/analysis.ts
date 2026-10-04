import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import * as extractedDataRepo from '@main/services/db/extractedDataRepo'
import * as selectorRepo from '@main/services/db/selectorRepo'
import * as tagRepo from '@main/services/db/tagRepo'
import * as waybackRefRepo from '@main/services/db/waybackRefRepo'
import { READ_ONLY, json } from '../results'

// Tags, selectors, extracted data and pinned Wayback snapshots: the analysis
// an investigator layers over a Case's Captures.
export function registerAnalysisTools(server: McpServer): void {
  server.registerTool(
    'list_tags',
    {
      description: 'Every Tag, with how many Captures in the given Case carry it.',
      inputSchema: z.object({ caseId: z.string() }),
      annotations: READ_ONLY
    },
    ({ caseId }) => {
      const usage = tagRepo.getTagUsageCountsForCase(caseId)
      return json(tagRepo.listTags().map((t) => ({ ...t, captureCount: usage[t.id] ?? 0 })))
    }
  )

  server.registerTool(
    'list_selectors',
    {
      description:
        "A Case's selectors (watched names, handles, emails, patterns) with how many " +
        'Captures each matches. List the matching Captures with list_captures.',
      inputSchema: z.object({ caseId: z.string() }),
      annotations: READ_ONLY
    },
    ({ caseId }) => {
      const counts = selectorRepo.getSelectorMatchCounts(caseId)
      return json(
        selectorRepo.listSelectors(caseId).map((s) => ({ ...s, matchCount: counts[s.id] ?? 0 }))
      )
    }
  )

  server.registerTool(
    'list_extracted_data',
    {
      description:
        'Indicators Birdbrain extracted from Capture text (emails, phones, URLs, crypto ' +
        'addresses and so on). With no category, lists categories and subcategories with ' +
        'counts; with a category and subcategory, lists each value and the URLs it was ' +
        'found on.',
      inputSchema: z.object({
        caseId: z.string(),
        category: z.string().optional(),
        subcategory: z.string().optional()
      }),
      annotations: READ_ONLY
    },
    ({ caseId, category, subcategory }) => {
      if (category && subcategory) {
        return json(extractedDataRepo.getExtractedItems(caseId, category, subcategory))
      }
      const categories = extractedDataRepo
        .getExtractedCategories(caseId)
        .filter((c) => !category || c.category === category)
      return json(
        categories.map((c) => ({
          ...c,
          subcategories: extractedDataRepo.getExtractedSubcategories(caseId, c.category)
        }))
      )
    }
  )

  server.registerTool(
    'search_extracted_data',
    {
      description: "Search a Case's extracted indicators by value.",
      inputSchema: z.object({ caseId: z.string(), query: z.string().min(1) }),
      annotations: READ_ONLY
    },
    ({ caseId, query }) => json(extractedDataRepo.searchExtractedData(caseId, query))
  )

  server.registerTool(
    'list_wayback_refs',
    {
      description:
        'Wayback Machine snapshots the investigator pinned to Captures in a Case as ' +
        'corroboration. Reads only what is pinned; never contacts archive.org.',
      inputSchema: z.object({ caseId: z.string() }),
      annotations: READ_ONLY
    },
    ({ caseId }) => json(waybackRefRepo.listWaybackRefsForCase(caseId))
  )
}
