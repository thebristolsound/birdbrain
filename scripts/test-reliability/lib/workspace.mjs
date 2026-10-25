// Temporary edits to tracked files, with a journal on disk while any edit is live.
//
// Both probes rewrite source files the tests import, and a mutant left behind in an evidence
// path is the worst outcome this tool can have. So every edit keeps the original bytes in
// memory, `restore()` puts them back, and the journal names the edited files until it does.
// A run killed before it restores (SIGKILL, power loss) leaves the journal, and the next run
// refuses to start until the files are checked out again.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const JOURNAL = '.cache/test-reliability/journal.json'

export const restoreCommand = (paths) =>
  `git checkout HEAD -- ${paths.map((path) => `'${path}'`).join(' ')}`

export const checkJournal = (root) => {
  const journal = join(root, JOURNAL)
  if (!existsSync(journal)) return
  const { paths } = JSON.parse(readFileSync(journal, 'utf8'))
  throw new Error(
    `an earlier run stopped with edited files in place: ${paths.join(', ')}. ` +
      `Restore them (${restoreCommand(paths)}, and delete any that HEAD does not have), ` +
      `then delete ${JOURNAL}.`
  )
}

export const createWorkspace = (root) => {
  const originals = new Map()
  const journal = join(root, JOURNAL)

  const remember = (path) => {
    if (originals.has(path)) return
    const absolute = join(root, path)
    originals.set(path, existsSync(absolute) ? readFileSync(absolute) : null)
    mkdirSync(dirname(journal), { recursive: true })
    writeFileSync(journal, JSON.stringify({ paths: [...originals.keys()] }, null, 2))
  }

  return {
    write(path, content) {
      remember(path)
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), content)
    },
    remove(path) {
      remember(path)
      rmSync(join(root, path), { force: true })
    },
    restore() {
      for (const [path, content] of originals) {
        if (content === null) rmSync(join(root, path), { force: true })
        else writeFileSync(join(root, path), content)
      }
      originals.clear()
      rmSync(journal, { force: true })
    },
    get edited() {
      return [...originals.keys()]
    }
  }
}
