// Shapes shared by the case builder, the runner and the grader. Validation is
// hand-rolled: the bench adds no dependency, and the shapes are small.

export const VERDICTS = ['approve for human review', 'request changes']
export const STATUSES = ['ok', 'error', 'rate_limited', 'unsupported']
export const CATEGORIES = [
  'removed-guard',
  'swapped-comparison',
  'swallowed-error',
  'overclaim',
  'off-by-one',
  'wrong-default',
  'wrong-argument'
]
export const KINDS = ['mutation', 'real']
export const HARNESSES = ['claude', 'codex']
export const TIERS = ['L0', 'L1', 'L2']

const SHA = /^[0-9a-f]{40}$/
const ID = /^[a-z0-9][a-z0-9-]*$/

const isInt = (x) => Number.isInteger(x)
const isStr = (x) => typeof x === 'string' && x.length > 0
const isArr = Array.isArray

function checkDefect(d, where, out) {
  if (!d || typeof d !== 'object') return out.push(`${where}: not an object`)
  if (!isStr(d.id)) out.push(`${where}.id: required`)
  if (!isStr(d.file)) out.push(`${where}.file: required`)
  if (d.lineStart !== undefined && !isInt(d.lineStart)) out.push(`${where}.lineStart: integer`)
  if (d.lineEnd !== undefined && !isInt(d.lineEnd)) out.push(`${where}.lineEnd: integer`)
  if (isInt(d.lineStart) && isInt(d.lineEnd) && d.lineEnd < d.lineStart) {
    out.push(`${where}: lineEnd before lineStart`)
  }
  if (!CATEGORIES.includes(d.category))
    out.push(`${where}.category: one of ${CATEGORIES.join(', ')}`)
  if (typeof d.blocking !== 'boolean') out.push(`${where}.blocking: boolean`)
  if (!isStr(d.description)) out.push(`${where}.description: required`)
}

export function validateTruth(truth, where = 'truth') {
  const out = []
  if (!truth || typeof truth !== 'object') return [`${where}: not an object`]
  if (!VERDICTS.includes(truth.verdict))
    out.push(`${where}.verdict: one of ${VERDICTS.join(' | ')}`)
  if (!isArr(truth.defects)) out.push(`${where}.defects: array`)
  else truth.defects.forEach((d, i) => checkDefect(d, `${where}.defects[${i}]`, out))
  if (!isArr(truth.refuted)) out.push(`${where}.refuted: array`)
  else {
    truth.refuted.forEach((r, i) => {
      const w = `${where}.refuted[${i}]`
      if (!r || typeof r !== 'object') return out.push(`${w}: not an object`)
      if (!isStr(r.file)) out.push(`${w}.file: required`)
      if (r.lineStart !== undefined && !isInt(r.lineStart)) out.push(`${w}.lineStart: integer`)
      if (r.lineEnd !== undefined && !isInt(r.lineEnd)) out.push(`${w}.lineEnd: integer`)
      if (!isStr(r.description)) out.push(`${w}.description: required`)
    })
  }
  const ids = new Set()
  for (const d of truth.defects ?? []) {
    if (ids.has(d?.id)) out.push(`${where}.defects: duplicate id ${d.id}`)
    ids.add(d?.id)
  }
  return out
}

export function validateCaseSpec(spec) {
  const out = []
  if (!spec || typeof spec !== 'object') return ['spec: not an object']
  if (!isStr(spec.id) || !ID.test(spec.id)) out.push('id: lowercase letters, digits and dashes')
  if (!KINDS.includes(spec.kind)) out.push(`kind: one of ${KINDS.join(' | ')}`)
  const src = spec.source
  if (!src || typeof src !== 'object') out.push('source: required')
  else {
    if (!isInt(src.pr)) out.push('source.pr: integer')
    if (!SHA.test(src.base ?? '')) out.push('source.base: 40-hex sha')
    if (!SHA.test(src.head ?? '')) out.push('source.head: 40-hex sha')
  }
  if (!isArr(spec.tags) || !spec.tags.every(isStr)) out.push('tags: array of strings')
  if (spec.kind === 'mutation') {
    if (!isArr(spec.mutations) || spec.mutations.length === 0)
      out.push('mutations: non-empty array')
    else {
      spec.mutations.forEach((m, i) => {
        const w = `mutations[${i}]`
        if (!m || typeof m !== 'object') return out.push(`${w}: not an object`)
        if (!isStr(m.id)) out.push(`${w}.id: required`)
        if (!isStr(m.file)) out.push(`${w}.file: required`)
        if (!isStr(m.find)) out.push(`${w}.find: required`)
        if (typeof m.replace !== 'string') out.push(`${w}.replace: string`)
        if (!CATEGORIES.includes(m.category))
          out.push(`${w}.category: one of ${CATEGORIES.join(', ')}`)
        if (typeof m.blocking !== 'boolean') out.push(`${w}.blocking: boolean`)
        if (!isStr(m.description)) out.push(`${w}.description: required`)
      })
    }
    if (spec.truth !== undefined) out.push('truth: derived for mutation cases, do not set')
  }
  if (spec.kind === 'real') {
    if (spec.mutations !== undefined) out.push('mutations: only on mutation cases')
    out.push(...validateTruth(spec.truth))
  }
  return out
}

export function validateResultRow(row) {
  const out = []
  if (!row || typeof row !== 'object') return ['row: not an object']
  if (!isStr(row.case)) out.push('case: required')
  if (!isStr(row.model)) out.push('model: required')
  if (!HARNESSES.includes(row.harness)) out.push(`harness: one of ${HARNESSES.join(' | ')}`)
  if (!TIERS.includes(row.tier)) out.push(`tier: one of ${TIERS.join(' | ')}`)
  if (!isStr(row.effort)) out.push('effort: required')
  if (!isInt(row.rep) || row.rep < 1) out.push('rep: positive integer')
  if (!isStr(row.manifest)) out.push('manifest: required')
  if (!STATUSES.includes(row.status)) out.push(`status: one of ${STATUSES.join(' | ')}`)
  if (row.status === 'ok') {
    const o = row.output
    if (!o || typeof o !== 'object') out.push('output: required when status is ok')
    else {
      if (!VERDICTS.includes(o.verdict)) out.push(`output.verdict: one of ${VERDICTS.join(' | ')}`)
      if (!isArr(o.findings)) out.push('output.findings: array')
      else {
        o.findings.forEach((f, i) => {
          const w = `output.findings[${i}]`
          if (!f || typeof f !== 'object') return out.push(`${w}: not an object`)
          if (f.file !== undefined && f.file !== null && !isStr(f.file))
            out.push(`${w}.file: string`)
          if (f.line !== undefined && f.line !== null && !isInt(f.line))
            out.push(`${w}.line: integer`)
          if (f.quote !== undefined && f.quote !== null && typeof f.quote !== 'string') {
            out.push(`${w}.quote: string`)
          }
          if (!isStr(f.summary)) out.push(`${w}.summary: required`)
          if (typeof f.blocking !== 'boolean') out.push(`${w}.blocking: boolean`)
        })
      }
    }
  } else if (row.output !== undefined && row.output !== null) {
    out.push(`output: must be absent when status is ${row.status}`)
  }
  return out
}

export const configKey = (row) => `${row.harness}/${row.model}/${row.tier}/${row.effort}`
