export type Ctx = {
  root: string
  paths: string[]
  read: (path: string) => string
  knip: () => unknown
  today: string
}

export type Measurement = { value: number; note?: string | null }

export type Signal = {
  id: string
  family: string
  label: string
  unit: 'count' | 'percent'
  better: 'lower' | 'higher'
  budget: number
  why: string
  needs: string
  measure: (ctx: Ctx) => Measurement
}

// An in-memory tracked tree: the keys are what `git ls-files` would list.
export const ctxOf = (tree: Record<string, string>, over: Partial<Ctx> = {}): Ctx => ({
  root: '/fixture',
  paths: Object.keys(tree),
  read: (path) => {
    if (!(path in tree)) throw new Error(`no such file ${path}`)
    return tree[path]
  },
  knip: () => {
    throw new Error('knip is not stubbed in this test')
  },
  today: '2026-11-21',
  ...over
})

export const signalOf = (signals: Signal[], id: string): Signal => {
  const signal = signals.find((entry) => entry.id === id)
  if (!signal) throw new Error(`no signal ${id}`)
  return signal
}

const KINDS = [
  'files',
  'exports',
  'types',
  'enumMembers',
  'namespaceMembers',
  'duplicates',
  'dependencies',
  'devDependencies'
]

// One knip issue row, shaped as knip 6 prints it: every kind is a list.
export const knipIssue = (file: string, counts: Record<string, number> = {}) => ({
  file,
  ...Object.fromEntries(
    KINDS.map((kind) => [
      kind,
      Array.from({ length: counts[kind] ?? 0 }, (_, index) => ({ name: `${kind}${index}` }))
    ])
  )
})
