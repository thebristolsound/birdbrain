// Pulls the labelled data every benchmark scores against. Reads GitHub through `gh` and the
// local git history; writes fixtures/*.json and fixtures/diffs/<pr>.diff. Re-run to refresh.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'

const here = new URL('./fixtures/', import.meta.url).pathname
mkdirSync(`${here}diffs`, { recursive: true })
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts })
const gh = (args) => JSON.parse(sh('gh', args))

const prs = gh(['pr', 'list', '--state', 'merged', '--limit', '500', '--json',
  'number,title,body,labels,files,mergedAt,author',
  '--jq', '[.[] | {number,title,mergedAt,author:.author.login,labels:[.labels[].name],files:[.files[] | {path,additions,deletions}],body}]'])
writeFileSync(`${here}prs.json`, JSON.stringify(prs))

const issues = gh(['issue', 'list', '--state', 'all', '--limit', '400', '--json', 'number,title,body,labels,state',
  '--jq', '[.[] | {number,title,state,labels:[.labels[].name],body}]'])
writeFileSync(`${here}issues.json`, JSON.stringify(issues))

const log = sh('git', ['log', 'origin/main', '-300', '--format=@@%H|%s', '--name-only'])
const commits = []
for (const blk of log.split('@@').slice(1)) {
  const [head, ...files] = blk.trim().split('\n')
  const [sha, subj] = head.split('|')
  const m = subj.match(/^([a-z]+)(\(([^)]*)\))?!?: (.*)$/)
  if (m) commits.push({ sha, type: m[1], scope: m[3] || null, subject: m[4], files: files.filter(Boolean) })
}
writeFileSync(`${here}commits.json`, JSON.stringify(commits))

// Diffs: every PR with an Evidence impact section (claim check) plus the incidental brushes the
// evidence-path assessment names (#786, #455, #357, #478) and the db/** residuals (#677, #435).
const withImpact = prs.filter((p) => /### Evidence impact/.test(p.body)).slice(0, 40).map((p) => p.number)
const wanted = [...new Set([...withImpact, 786, 455, 357, 478, 677, 435, 1569])]
let fetched = 0
for (const n of wanted) {
  const f = `${here}diffs/${n}.diff`
  if (existsSync(f) && statSync(f).size > 0) continue
  try {
    writeFileSync(f, sh('gh', ['pr', 'diff', String(n)]))
    fetched++
  } catch (e) {
    console.error(`diff ${n} failed: ${e.message.split('\n')[0]}`)
  }
}
console.log(`prs=${prs.length} issues=${issues.length} commits=${commits.length} diffs fetched=${fetched} wanted=${wanted.length}`)
