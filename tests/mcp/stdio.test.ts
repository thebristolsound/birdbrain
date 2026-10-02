import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { spawn } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { build } from 'esbuild'
import { seedMcpUserData, type McpCase } from '../helpers/mcpCase'

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

interface Run {
  code: number | null
  stdout: string
  stderr: string
}

// The entry as a client launches it: its own process, under Electron as Node,
// speaking newline-delimited JSON-RPC on stdio. The bundle is built from the
// current source rather than read from out/, which the CI test job never builds.
describe('Birdbrain MCP server over stdio (ADR-0036)', () => {
  let tempDir: string
  let bundle: string
  let fixture: McpCase

  function run(args: string[], messages: object[]): Promise<Run> {
    const env = { ...process.env }
    delete env.BIRDBRAIN_USER_DATA
    const child = spawn(process.execPath, [bundle, ...args], {
      env: { ...env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: join(process.cwd(), 'node_modules') }
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      // Close stdin once every request has its response; the server then exits.
      const answered = stdout.split('\n').filter((line) => line.includes('"id"')).length
      if (answered === messages.filter((m) => 'id' in m).length) child.stdin.end()
    })
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    for (const message of messages) child.stdin.write(JSON.stringify(message) + '\n')
    if (messages.length === 0) child.stdin.end()
    return new Promise((resolve) => child.on('close', (code) => resolve({ code, stdout, stderr })))
  }

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-mcp-stdio-'))
    fixture = await seedMcpUserData(tempDir)
    bundle = join(tempDir, 'mcp.cjs')
    await build({
      entryPoints: ['src/mcp/index.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      outfile: bundle,
      tsconfig: 'tsconfig.node.json',
      packages: 'external',
      logLevel: 'error'
    })
  })

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('refuses to start without a data folder', async () => {
    const { code, stdout, stderr } = await run([], [])

    expect(code).toBe(1)
    expect(stderr).toContain('No Birdbrain data folder given')
    expect(stdout).toBe('')
  })

  it('serves tool calls and writes only protocol messages to stdout', async () => {
    const { code, stdout, stderr } = await run(
      ['--user-data', tempDir],
      [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'smoke', version: '0' }
          }
        },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'verify_capture', arguments: { captureId: fixture.captureId } }
        }
      ]
    )

    expect(stderr).toBe('')
    expect(code).toBe(0)
    const lines = stdout.trim().split('\n')
    expect(lines).toHaveLength(2)
    const [initialized, verified] = lines.map(
      (line) =>
        JSON.parse(line) as {
          id: number
          result: { serverInfo?: { name: string }; content?: Array<{ text: string }> }
        }
    )
    expect([initialized.id, verified.id]).toEqual([1, 2])
    expect(initialized.result.serverInfo?.name).toBe('birdbrain')
    expect(JSON.parse(verified.result.content![0].text)).toMatchObject({
      captureId: fixture.captureId,
      status: 'verified'
    })
  })
})
