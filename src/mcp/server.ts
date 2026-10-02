import { McpServer } from '@modelcontextprotocol/server'
import { registerAnalysisTools } from './tools/analysis'
import { registerCaptureTools } from './tools/captures'
import { registerCaseTools } from './tools/cases'
import { registerCustodyTools } from './tools/custody'
import { registerNoteTools } from './tools/notes'

const INSTRUCTIONS = `Birdbrain is a web investigation tool. This server reads its Cases and never \
changes them.

A Case holds Captures (web pages acquired as MHTML with page text and a screenshot), uploaded \
files, Notes, Tags, selectors and extracted indicators. Every Capture and file is an Exhibit \
with an Exhibit Number. A signed, hash-chained manifest per Case records who acquired what and \
when.

To support a claim from a Case, cite the Capture's exhibitCitation and id, quote its page \
text, and run verify_capture. Integrity and trusted time are separate: "verified" with \
trustedTime "none" is intact bytes without an independent timestamp, not a failure.`

export function createBirdbrainServer(version: string): McpServer {
  const server = new McpServer(
    { name: 'birdbrain', version },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
  )
  registerCaseTools(server)
  registerCaptureTools(server)
  registerCustodyTools(server)
  registerNoteTools(server)
  registerAnalysisTools(server)
  return server
}
