// Applies a mutation spec to file contents and reports where the change landed,
// so the truth file carries line numbers without anyone typing them.

export class MutationError extends Error {
  constructor(mutation, reason) {
    super(`${mutation.id} (${mutation.file}): ${reason}`)
    this.name = 'MutationError'
    this.mutation = mutation
  }
}

const lineOf = (text, offset) => text.slice(0, offset).split('\n').length

export function applyMutation(content, mutation) {
  const { find, replace } = mutation
  const first = content.indexOf(find)
  if (first < 0) throw new MutationError(mutation, 'find text not present')
  if (content.indexOf(find, first + 1) >= 0)
    throw new MutationError(mutation, 'find text ambiguous')
  const next = content.slice(0, first) + replace + content.slice(first + find.length)
  const lineStart = lineOf(next, first)
  const lineEnd = replace.length === 0 ? lineStart : lineOf(next, first + replace.length - 1)
  return { content: next, lineStart, lineEnd }
}

// Mutations on one file apply in order, each against the previous result.
// Returns the mutated files, one truth defect per defect mutation, and one
// refuted entry per benign mutation.
export function applyMutations(readFile, mutations) {
  const files = new Map()
  const defects = []
  const benign = []
  for (const m of mutations) {
    const current = files.has(m.file) ? files.get(m.file) : readFile(m.file)
    if (current === null || current === undefined) throw new MutationError(m, 'file not at head')
    const { content, lineStart, lineEnd } = applyMutation(current, m)
    files.set(m.file, content)
    if (m.benign === true) {
      benign.push({ file: m.file, lineStart, lineEnd, description: m.description })
      continue
    }
    defects.push({
      id: m.id,
      file: m.file,
      lineStart,
      lineEnd,
      category: m.category,
      blocking: m.blocking,
      description: m.description
    })
  }
  return { files, defects, benign }
}

export function deriveTruth(defects, benign = []) {
  return {
    verdict: defects.some((d) => d.blocking) ? 'request changes' : 'approve for human review',
    defects,
    refuted: benign
  }
}
