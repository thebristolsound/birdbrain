import { execFileSync } from 'child_process'

// Extracts and executes the shell blocks of the SHIPPED VERIFY.md runbook (#584).
//
// The point is that nothing here knows what the runbook says. Blocks are taken
// from the generated text in document order, placeholders are resolved by name
// from a caller-supplied binding, and an unknown placeholder is an error rather
// than a skip — so a step-6 rewrite is picked up automatically, and a rewrite
// that introduces a placeholder nobody can bind fails loudly instead of quietly
// not being executed.

export interface RunbookBlock {
  /** Nearest preceding Markdown heading, used to name the step in a failure. */
  section: string
  /** 1-based position in the runbook, so two blocks under one heading stay distinct. */
  ordinal: number
  code: string
  /** Angle-bracket placeholders the block carries, e.g. `<contentHash>`. */
  placeholders: string[]
}

const HEADING = /^#{1,6} +(.+)$/
const PLACEHOLDER = /<[A-Za-z][A-Za-z0-9]*>/g

/**
 * Every ```sh block in the runbook, tagged with the heading it sits under.
 *
 * Walked line by line rather than matched with one regex, because a shell
 * comment (`# subject and issuer must be identical`) is indistinguishable from
 * a Markdown H1 to a pattern that does not track fence state — which mislabelled
 * every block after step 5 with the text of a comment inside step 6's block.
 * Only a fence opened with the `sh` info string is collected: the published
 * fingerprint is fenced without one, and it is a value to compare against, not
 * a command.
 */
export function extractRunbookBlocks(runbook: string): RunbookBlock[] {
  const blocks: RunbookBlock[] = []
  let section = '(before the first heading)'
  let collecting: string[] | null = null
  let inFence = false

  for (const line of runbook.split('\n')) {
    if (line.startsWith('```')) {
      if (!inFence) {
        inFence = true
        collecting = line.slice(3).trim() === 'sh' ? [] : null
        continue
      }
      inFence = false
      if (collecting !== null) {
        const code = collecting.length === 0 ? '' : `${collecting.join('\n')}\n`
        blocks.push({
          section,
          ordinal: blocks.length + 1,
          code,
          placeholders: [...new Set(code.match(PLACEHOLDER) ?? [])]
        })
      }
      collecting = null
      continue
    }
    if (inFence) {
      collecting?.push(line)
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) section = heading[1].trim()
  }

  return blocks
}

export interface RunbookRunResult {
  ok: boolean
  status: number
  stdout: string
  stderr: string
  /** Label of the block that failed, or null when everything ran. */
  failedBlock: string | null
  /** Labels of every block that was executed, in order. */
  executed: string[]
}

const label = (block: RunbookBlock): string => `block ${block.ordinal} (${block.section})`

const singleQuote = (value: string): string => `'${value.split("'").join(`'\\''`)}'`

const MARKER = 'BIRDBRAIN_RUNBOOK_BLOCK_FAILED'

/**
 * Runs every block in one shell, in document order, so state a block sets up
 * (`line=$(sed -n '1p' manifest.jsonl)`) is still there for the blocks that use
 * it. A block carrying placeholders is run once per binding.
 *
 * Executed under `bash` with `set -euo pipefail` rather than plain `sh`. The
 * blocks themselves are POSIX, but a command that stops working mid-pipeline —
 * which is how #578 presented — leaves a pipeline's exit status at 0 without
 * `pipefail`, and a check that cannot fail is the thing this replaces.
 */
export function runRunbookBlocks(
  blocks: RunbookBlock[],
  options: { cwd: string; bindings?: Array<Record<string, string>> }
): RunbookRunResult {
  const bindings = options.bindings ?? []
  const parts = [
    'set -euo pipefail',
    '__bb_block=prelude',
    `trap 'printf "${MARKER} %s\\n" "$__bb_block" >&2' ERR`
  ]
  const executed: string[] = []

  for (const block of blocks) {
    if (block.placeholders.length === 0) {
      executed.push(label(block))
      parts.push(`__bb_block=${singleQuote(label(block))}`, block.code)
      continue
    }
    if (bindings.length === 0) {
      throw new Error(
        `${label(block)} carries ${block.placeholders.join(', ')} but no bindings were supplied`
      )
    }
    bindings.forEach((binding, i) => {
      let code = block.code
      for (const placeholder of block.placeholders) {
        const value = binding[placeholder]
        if (value === undefined) {
          throw new Error(
            `${label(block)} carries the placeholder ${placeholder}, which this harness cannot ` +
              `resolve. Teach tests/helpers/runbookBlocks.ts callers how to bind it — leaving it ` +
              `unbound would mean the step is documented but never executed.`
          )
        }
        code = code.split(placeholder).join(value)
      }
      const name = `${label(block)} binding ${i + 1}/${bindings.length}`
      executed.push(name)
      parts.push(`__bb_block=${singleQuote(name)}`, code)
    })
  }

  let stdout: string
  let stderr = ''
  let status = 0
  try {
    stdout = execFileSync('bash', ['-c', parts.join('\n')], {
      cwd: options.cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (error) {
    const spawned = error as { status?: number; stdout?: string; stderr?: string }
    status = spawned.status ?? 1
    stdout = spawned.stdout ?? ''
    stderr = spawned.stderr ?? ''
  }

  const markers = stderr.split('\n').filter((l) => l.startsWith(MARKER))
  return {
    ok: status === 0,
    status,
    stdout,
    stderr,
    failedBlock: markers.length > 0 ? markers[markers.length - 1].slice(MARKER.length).trim() : null,
    executed
  }
}
