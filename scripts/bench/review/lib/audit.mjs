// The tool-log audit: the truth file is not hidden from a model with tools,
// only kept out of its working directory, so every recorded tool call is
// checked for a reach beyond that directory. A probe is a call that names
// the truth file, the fixture or case directories, the runner's environment
// variables, or lists git worktrees (which prints the runner's checkout).

const PROBES = [
  { name: 'truth-file', re: /truth\.json/ },
  { name: 'fixtures-dir', re: /scripts\/bench\/review\/(fixtures|cases|results)/ },
  { name: 'bench-env', re: /BENCH_GH_|printenv|\benv\b\s*(\||$)/ },
  { name: 'worktree-list', re: /git\s+worktree\s+list/ }
]

const textOf = (call) =>
  typeof call?.input === 'string' ? call.input : JSON.stringify(call?.input ?? '')

// One tool log (parsed JSON lines) to the probes it holds, deduplicated by kind.
export function auditToolLog(calls, { allow = [] } = {}) {
  const hits = []
  for (const call of calls) {
    const text = textOf(call)
    if (allow.some((a) => a && text.includes(a))) continue
    for (const p of PROBES) {
      if (p.re.test(text))
        hits.push({ probe: p.name, tool: call?.name ?? null, text: text.slice(0, 200) })
    }
  }
  return hits
}

export const parseToolLog = (text) =>
  String(text ?? '')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
