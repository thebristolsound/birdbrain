import { existsSync } from 'fs'
import { resolve } from 'path'
import { IpcFailure } from '@main/ipcWrap'
import type { IpcHandlers } from '@main/ipc/handlers'

// The two Electron shell calls these handlers make.
export interface RevealShell {
  showItemInFolder(path: string): void
  // Resolves with an error message, or an empty string when the file opened.
  openPath(path: string): Promise<string>
}

export interface RevealFiles {
  // Permits reveal and open for a file this process has just written.
  remember(filePath: string): void
  handlers: IpcHandlers<'shell:showItemInFolder' | 'shell:openPath'>
}

// Bounded with FIFO eviction so the allowlist can't grow for the life of the
// process; only recent exports stay openable.
const MAX_REVEALABLE_PATHS = 64

// Reveal/open is limited to files THIS process authored (export outputs). A
// renderer — even a compromised one — can't hand shell.openPath an arbitrary
// binary, because only paths recorded here on a successful export are openable.
export function createRevealFiles(shell: RevealShell): RevealFiles {
  const revealable = new Set<string>()

  function permitted(path: string): string {
    if (!path) throw new IpcFailure('Path is required', 'INVALID_PATH')
    if (!revealable.has(resolve(path))) throw new IpcFailure('Path not permitted', 'FORBIDDEN_PATH')
    if (!existsSync(path)) throw new IpcFailure('File not found', 'NOT_FOUND')
    return path
  }

  return {
    remember(filePath) {
      const resolved = resolve(filePath)
      // delete-then-add so re-exporting the same destination refreshes its recency.
      // Set.add on an already-present value keeps its original insertion position,
      // which would let a just-rewritten path be evicted by newer unrelated exports.
      revealable.delete(resolved)
      revealable.add(resolved)
      if (revealable.size > MAX_REVEALABLE_PATHS) {
        revealable.delete(revealable.values().next().value as string)
      }
    },
    handlers: {
      'shell:showItemInFolder': (_, path) => {
        shell.showItemInFolder(permitted(path))
      },
      'shell:openPath': async (_, path) => {
        const openError = await shell.openPath(permitted(path))
        if (openError) throw new IpcFailure(openError, 'OPEN_PATH_FAILED')
      }
    }
  }
}
