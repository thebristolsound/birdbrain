import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createHash } from 'crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { closeDatabase, openDatabaseReadOnly } from '@main/services/db/core'
import { resetInstallationId } from '@main/services/installationId'
import { initVerifyOnlyKey, resetSigningKey } from '@main/services/signingKey'
import { createBirdbrainServer } from '../../src/mcp/server'
import { storedFilePath } from '../../src/mcp/results'
import {
  MCP_MHTML_BODY,
  MCP_PAGE_TEXT,
  MCP_TEXT_FILE,
  seedMcpUserData,
  type McpCase
} from '../helpers/mcpCase'

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

const TOOLS = [
  'get_capture',
  'get_capture_html',
  'get_capture_screenshot',
  'get_capture_text',
  'get_case',
  'get_exhibit_file',
  'get_manifest',
  'get_note',
  'list_captures',
  'list_cases',
  'list_exhibits',
  'list_extracted_data',
  'list_notes',
  'list_selectors',
  'list_tags',
  'list_wayback_refs',
  'note_backlinks',
  'note_graph',
  'recent_activity',
  'search_captures',
  'search_extracted_data',
  'search_notes',
  'verify_capture',
  'verify_exhibit'
]

interface JsonRpcResponse {
  id: number
  result?: Record<string, unknown>
  error?: { message: string }
}

// A JSON-RPC client over the SDK's in-memory transport, so the tools are
// exercised through the protocol without a client package.
async function connect(): Promise<{
  request: (method: string, params: Record<string, unknown>) => Promise<JsonRpcResponse>
  close: () => Promise<void>
}> {
  const [client, serverSide] = InMemoryTransport.createLinkedPair()
  await createBirdbrainServer('test').connect(serverSide)
  const pending = new Map<number, (response: JsonRpcResponse) => void>()
  client.onmessage = (message) => {
    const response = message as unknown as JsonRpcResponse
    pending.get(response.id)?.(response)
    pending.delete(response.id)
  }
  await client.start()
  let nextId = 1
  const request = (method: string, params: Record<string, unknown>) =>
    new Promise<JsonRpcResponse>((resolve) => {
      const id = nextId++
      pending.set(id, resolve)
      void client.send({ jsonrpc: '2.0', id, method, params })
    })
  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' }
  })
  await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  return { request, close: () => client.close() }
}

// Every byte this server could change: the database file and the storage root.
// SQLite's -wal and -shm files are left out; a read-only open creates them
// empty and removes them on close.
function fingerprint(tempDir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else out[path] = createHash('sha256').update(readFileSync(path)).digest('hex')
    }
  }
  walk(join(tempDir, 'captures'))
  const db = join(tempDir, 'birdbrain.db')
  out[db] = createHash('sha256').update(readFileSync(db)).digest('hex')
  return out
}

describe('Birdbrain MCP server (ADR-0038)', () => {
  let tempDir: string
  let fixture: McpCase
  let before: Record<string, string>
  let rpc: Awaited<ReturnType<typeof connect>>

  async function call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
    const response = await rpc.request('tools/call', { name, arguments: args })
    if (response.error) throw new Error(response.error.message)
    return response.result as CallToolResult
  }

  async function data<T = Record<string, unknown>>(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<T> {
    const result = await call(name, args)
    expect(result.isError).toBeFalsy()
    const [first] = result.content
    if (first.type !== 'text') throw new Error(`${name} returned ${first.type}`)
    return JSON.parse(first.text) as T
  }

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-mcp-'))
    fixture = await seedMcpUserData(tempDir)

    before = fingerprint(tempDir)
    openDatabaseReadOnly(join(tempDir, 'birdbrain.db'))
    initVerifyOnlyKey(tempDir)
    rpc = await connect()
  })

  afterAll(async () => {
    await rpc.close()
    closeDatabase()
    resetSigningKey()
    resetInstallationId()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('lists every tool, each marked read-only and closed-world', async () => {
    const { result } = await rpc.request('tools/list', {})
    const tools = (result?.tools ?? []) as Array<{ name: string; annotations: object }>

    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS)
    for (const tool of tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: false })
    }
  })

  it('reads Cases and their overview counts', async () => {
    const cases = await data<Array<{ id: string; captureCount: number }>>('list_cases')
    expect(cases).toEqual([expect.objectContaining({ id: fixture.caseId, captureCount: 2 })])

    expect(await data('get_case', { caseId: fixture.caseId })).toMatchObject({
      name: 'MCP Case',
      captureCount: 2,
      noteCount: 1,
      tagsInUse: 1,
      extractedDataCount: 1,
      selectorCoverage: { matched: 1, total: 2 }
    })
    expect((await call('get_case', { caseId: 'nope' })).isError).toBe(true)
    expect(await data<unknown[]>('recent_activity', { limit: 5 })).not.toHaveLength(0)
  })

  it('lists Captures with their citation, and filters by Tag, selector and favourite', async () => {
    const { caseId, captureId, tagId, selectorId } = fixture
    const all = await data<Array<Record<string, unknown>>>('list_captures', { caseId })
    expect(all).toHaveLength(2)
    expect(all).toContainEqual(
      expect.objectContaining({
        id: captureId,
        exhibitNumber: expect.any(Number),
        contentHash: fixture.captureHash,
        favorite: false
      })
    )

    expect(await data('list_captures', { caseId, tagIds: [tagId] })).toHaveLength(1)
    expect(await data('list_captures', { caseId, tagIds: ['other'] })).toHaveLength(0)
    expect(await data('list_captures', { caseId, selectorIds: [selectorId] })).toHaveLength(1)
    expect(await data('list_captures', { caseId, favoritesOnly: true })).toHaveLength(0)
    expect(await data('search_captures', { caseId, query: 'extracted' })).toHaveLength(1)
  })

  it('reads one Capture with everything the app shows beside it', async () => {
    const capture = await data<Record<string, unknown>>('get_capture', {
      captureId: fixture.captureId
    })

    expect(capture).toMatchObject({
      id: fixture.captureId,
      favorite: false,
      tags: [expect.objectContaining({ name: 'Lead' })],
      matchingSelectors: [expect.objectContaining({ id: fixture.selectorId })],
      annotations: { annotations: expect.objectContaining({ imageWidth: 24 }) },
      waybackRefs: [expect.objectContaining({ originalUrl: 'https://example.com/page' })]
    })
    expect((await call('get_capture', { captureId: 'nope' })).isError).toBe(true)
  })

  it('pages Capture text and HTML', async () => {
    const { captureId } = fixture
    expect(await data('get_capture_text', { captureId })).toMatchObject({
      text: MCP_PAGE_TEXT,
      totalLength: MCP_PAGE_TEXT.length,
      nextOffset: null
    })
    expect(await data('get_capture_text', { captureId, offset: 2, length: 3 })).toMatchObject({
      text: 'tra',
      offset: 2,
      nextOffset: 5
    })
    const html = await data('get_capture_html', { captureId: fixture.mhtmlCaptureId })
    expect(html).toMatchObject({ text: MCP_MHTML_BODY, nextOffset: null })
  })

  it('returns a screenshot as an image', async () => {
    const result = await call('get_capture_screenshot', { captureId: fixture.captureId })

    expect(result.content).toEqual([
      expect.objectContaining({ type: 'image', mimeType: 'image/png' })
    ])
  })

  it('reads the Exhibit inventory and each kind of stored file', async () => {
    const { caseId, image, document, textFileId, captureId } = fixture
    const inventory = await data<{ rows: Array<{ kind?: string }> }>('list_exhibits', { caseId })
    expect(inventory.rows.map((row) => row.kind)).toEqual(
      expect.arrayContaining(['capture', 'image', 'document', 'attachment'])
    )

    const picture = await call('get_exhibit_file', { exhibitId: image.id })
    expect(picture.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' })
    expect(await data('get_exhibit_file', { exhibitId: textFileId })).toMatchObject({
      name: 'statement.txt',
      text: MCP_TEXT_FILE
    })
    expect(await data('get_exhibit_file', { exhibitId: document.id })).toMatchObject({
      kind: 'document',
      inline: false,
      absolutePath: expect.stringContaining(tempDir)
    })
    expect((await call('get_exhibit_file', { exhibitId: captureId })).isError).toBe(true)
    expect((await call('get_exhibit_file', { exhibitId: 'nope' })).isError).toBe(true)
  })

  it('reads the signed manifest and verifies without recording', async () => {
    const { caseId, captureId, document } = fixture
    const manifest = await data<{ chain: { valid: boolean }; entries: unknown[] }>('get_manifest', {
      caseId
    })
    expect(manifest.chain.valid).toBe(true)
    expect(manifest.entries).not.toHaveLength(0)

    expect(await data('verify_capture', { captureId })).toMatchObject({ status: 'verified' })
    expect(await data('verify_exhibit', { caseId, exhibitId: document.id })).toMatchObject({
      status: 'verified'
    })
    expect(await data('verify_exhibit', { caseId, exhibitId: captureId })).toMatchObject({
      status: 'verified',
      capture: expect.objectContaining({ status: 'verified' })
    })
  })

  it('reads Notes, their mentions and backlinks', async () => {
    const { caseId, captureId, noteId } = fixture
    const notes = await data<Array<Record<string, unknown>>>('list_notes', { caseId })
    expect(notes).toEqual([expect.objectContaining({ id: noteId, body: 'Seen on @Page' })])
    expect(notes[0]).not.toHaveProperty('bodyDoc')

    expect(await data('get_note', { noteId })).toMatchObject({
      tags: [],
      references: [expect.objectContaining({ targetType: 'capture', targetId: captureId })]
    })
    expect((await call('get_note', { noteId: 'nope' })).isError).toBe(true)
    expect(await data('search_notes', { caseId, query: 'Seen' })).toHaveLength(1)
    expect(
      await data('note_backlinks', { caseId, targetType: 'capture', targetId: captureId })
    ).toEqual([expect.objectContaining({ noteId })])
    expect(await data('note_graph', { caseId })).toEqual([
      expect.objectContaining({ noteId, targetId: captureId })
    ])
  })

  it('reads Tags, selectors, extracted data and pinned Wayback snapshots', async () => {
    const { caseId } = fixture
    expect(await data('list_tags', { caseId })).toEqual([
      expect.objectContaining({ name: 'Lead', captureCount: 1 })
    ])
    expect(await data('list_selectors', { caseId })).toEqual([
      expect.objectContaining({ pattern: 'extracted', matchCount: 1 })
    ])
    expect(await data('list_extracted_data', { caseId })).toEqual([
      { category: 'email', count: 1, subcategories: [{ subcategory: 'address', count: 1 }] }
    ])
    expect(await data('list_extracted_data', { caseId, category: 'phone' })).toEqual([])
    expect(
      await data('list_extracted_data', { caseId, category: 'email', subcategory: 'address' })
    ).toEqual([expect.objectContaining({ value: 'lead@example.com' })])
    expect(await data('search_extracted_data', { caseId, query: 'lead' })).toHaveLength(1)
    expect(await data('list_wayback_refs', { caseId })).toHaveLength(1)
  })

  it('refuses a stored path outside the storage root', () => {
    expect(() => storedFilePath('../outside.txt')).toThrow('outside the storage root')
  })

  it('changed no byte of the database or the storage root', () => {
    expect(statSync(join(tempDir, 'birdbrain.db')).size).toBeGreaterThan(0)
    expect(fingerprint(tempDir)).toEqual(before)
  })
})
