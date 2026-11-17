import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { IpcFailure } from '@main/ipcWrap'
import type { IpcCaller } from '@main/ipc/handlers'
import { createRevealFiles } from '@main/ipc/revealFiles'

// The reveal and open handlers, called directly with a fake shell: no Electron
// mock and no handler registration.

const caller: IpcCaller = { send: vi.fn() }

function setup() {
  const shell = { showItemInFolder: vi.fn(), openPath: vi.fn(async () => '') }
  const files = createRevealFiles(shell)
  const show = (path: string) => files.handlers['shell:showItemInFolder'](caller, path)
  const open = (path: string) => files.handlers['shell:openPath'](caller, path)
  return { shell, files, show, open }
}

async function refusal(run: () => unknown): Promise<{ message: string; code?: string }> {
  try {
    await run()
  } catch (err) {
    if (err instanceof IpcFailure) return { message: err.message, code: err.code }
    throw err
  }
  throw new Error('expected a refusal')
}

describe('createRevealFiles', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reveal-files-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const written = (name: string): string => {
    const path = join(dir, name)
    writeFileSync(path, '')
    return path
  }

  it('reveals and opens a file it was told about', async () => {
    const { shell, files, show, open } = setup()
    const path = written('evidence.zip')
    files.remember(path)

    show(path)
    expect(shell.showItemInFolder).toHaveBeenCalledWith(path)
    await open(path)
    expect(shell.openPath).toHaveBeenCalledWith(path)
  })

  it('refuses a file it was not told about, without calling the shell', async () => {
    const { shell, show, open } = setup()
    const path = written('evil.exe')

    expect(await refusal(() => show(path))).toEqual({
      message: 'Path not permitted',
      code: 'FORBIDDEN_PATH'
    })
    expect(await refusal(() => open(path))).toEqual({
      message: 'Path not permitted',
      code: 'FORBIDDEN_PATH'
    })
    expect(shell.showItemInFolder).not.toHaveBeenCalled()
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('refuses an empty path, and a remembered file that is gone', async () => {
    const { shell, files, show, open } = setup()
    const gone = join(dir, 'gone.zip')
    files.remember(gone)

    expect(await refusal(() => show(''))).toEqual({
      message: 'Path is required',
      code: 'INVALID_PATH'
    })
    expect(await refusal(() => open(gone))).toEqual({
      message: 'File not found',
      code: 'NOT_FOUND'
    })
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('matches a file by its resolved path', async () => {
    const { shell, files, open } = setup()
    const path = written('report.html')
    files.remember(relative(process.cwd(), path))

    await open(path)
    expect(shell.openPath).toHaveBeenCalledWith(path)
  })

  it('reports the message the shell gives when the file does not open', async () => {
    const { shell, files, open } = setup()
    const path = written('report.html')
    files.remember(path)
    shell.openPath.mockResolvedValueOnce('No application is registered')

    expect(await refusal(() => open(path))).toEqual({
      message: 'No application is registered',
      code: 'OPEN_PATH_FAILED'
    })
  })

  it('keeps the 64 files told about last, and telling it again counts as last', async () => {
    const { files, open } = setup()
    const first = written('first.zip')
    const second = written('second.zip')
    files.remember(first)
    files.remember(second)
    for (let i = 0; i < 62; i++) files.remember(join(dir, `filler-${i}.zip`))
    // 64 remembered. Telling it about the first again moves it behind the second.
    files.remember(first)
    files.remember(join(dir, 'one-more.zip'))

    await expect(open(first)).resolves.toBeUndefined()
    expect((await refusal(() => open(second))).code).toBe('FORBIDDEN_PATH')
  })
})
