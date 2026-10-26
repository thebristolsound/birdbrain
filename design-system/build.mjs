#!/usr/bin/env node
// Rebuilds the Birdbrain design system (the Design System artifact) from the code.
//
//   node design-system/build.mjs            write dist/project/ and report
//   node design-system/build.mjs --check    the same, exit 1 on any finding
//   node design-system/build.mjs --with-assets   also copy the logo files into dist/
//
// Reads: src/renderer/styles/globals.css (every custom property), the font files, the logo
// records and the hand-maintained notes, type styles and prose in this folder. Writes the
// file tree the artifact type expects under dist/project/. Publishing is a separate step; see
// README.md beside this file. No dependencies beyond Node 20.

import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  cpSync
} from 'node:fs'
import { dirname, join, relative, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const args = new Set(process.argv.slice(2))
const check = args.has('--check')
const withAssets = args.has('--with-assets')
const argValue = (flag) => {
  const i = process.argv.indexOf(flag)
  return i > -1 ? process.argv[i + 1] : undefined
}

const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'))
const notes = JSON.parse(readFileSync(join(here, 'notes.json'), 'utf8'))
const typeStyles = JSON.parse(readFileSync(join(here, 'type-styles.json'), 'utf8'))
const dist = join(here, 'dist', 'project')
const findings = []
const warn = (msg) => findings.push(msg)

// --- 1. Parse globals.css into top-level rules -------------------------------------------
const cssPath = join(repo, sources.css)
const css = readFileSync(cssPath, 'utf8')

function topLevelRules(text) {
  const rules = []
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('{', i)
    if (open === -1) break
    let depth = 1
    let j = open + 1
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') depth--
      j++
    }
    const selector = text
      .slice(i, open)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim()
      .split(/[;\n]/)
      .pop()
      .trim()
    rules.push({ selector, body: text.slice(open + 1, j - 1) })
    i = j
  }
  return rules
}

// Declarations of custom properties in a rule body, each with the comment just before it.
function declarations(body) {
  const out = []
  const re = /(\/\*([\s\S]*?)\*\/\s*)?--([A-Za-z0-9_-]+)\s*:\s*([^;]+);/g
  let m
  while ((m = re.exec(body))) {
    out.push({ name: m[3], value: m[4].trim(), comment: m[2]?.replace(/\s+/g, ' ').trim() })
  }
  return out
}

const light = new Map()
const dark = new Map()
const density = { compact: new Map(), comfortable: new Map() }
const comments = new Map()

for (const rule of topLevelRules(css)) {
  const decls = declarations(rule.body)
  if (!decls.length) continue
  let target
  if (rule.selector === '@theme' || rule.selector === ':root') target = light
  else if (rule.selector === 'html.dark') target = dark
  else if (/data-density='compact'/.test(rule.selector)) target = density.compact
  else if (/data-density='comfortable'/.test(rule.selector)) target = density.comfortable
  else {
    warn(`globals.css: custom properties under "${rule.selector}" are not read`)
    continue
  }
  for (const d of decls) {
    target.set(d.name, d.value)
    if (d.comment && target === light) comments.set(d.name, d.comment)
  }
}

// --- 2. Classify -------------------------------------------------------------------------
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const families = { color: [], shadow: [], spacing: [], radius: [], tracking: [] }
const fontFamilies = {}
const colorNames = new Set([...light.keys()].filter((n) => n.startsWith('color-')))

const resolveLength = (v, seen = new Set()) => {
  const m = /^var\(--([A-Za-z0-9_-]+)\)$/.exec(v)
  if (!m) return v
  if (seen.has(m[1]) || !light.has(m[1])) return null
  seen.add(m[1])
  return resolveLength(light.get(m[1]), seen)
}
const colorValue = (v) => {
  const m = /^var\(--([A-Za-z0-9_-]+)\)$/.exec(v)
  if (m) {
    if (!colorNames.has(m[1])) warn(`${m[0]} points at a token that is not a colour`)
    return `{${m[1]}}`
  }
  if (/var\(|color-mix\(|calc\(/.test(v)) return null
  return /^#/.test(v) ? v.toLowerCase() : v
}

const usageFor = (name) => notes[name] ?? comments.get(name) ?? `Declared in ${sources.css}.`

for (const [name, rawLight] of light) {
  if (!NAME.test(name)) {
    warn(`token name "${name}" is not a legal token name`)
    continue
  }
  if (name.startsWith('color-')) {
    const l = colorValue(rawLight)
    const d = dark.has(name) ? colorValue(dark.get(name)) : undefined
    if (l === null || d === null) {
      warn(`${name}: value uses a function the tokens format cannot hold; skipped`)
      continue
    }
    families.color.push({
      name,
      value: d === undefined ? l : { light: l, dark: d },
      usage: usageFor(name)
    })
  } else if (name.startsWith('shadow-')) {
    const d = dark.get(name)
    families.shadow.push({
      name,
      value: d === undefined || d === rawLight ? rawLight : { light: rawLight, dark: d },
      usage: usageFor(name)
    })
  } else if (name.startsWith('radius') || name === 'd-r') {
    const v = resolveLength(rawLight)
    if (v === null) warn(`${name}: could not resolve ${rawLight}`)
    else families.radius.push({ name, value: v, usage: usageFor(name) })
  } else if (name.startsWith('d-')) {
    const v = resolveLength(rawLight)
    if (v === null) {
      warn(`${name}: could not resolve ${rawLight}`)
      continue
    }
    let usage = usageFor(name)
    const c = density.compact.get(name)
    const k = density.comfortable.get(name)
    if (c && k) usage = `${usage.replace(/\s+$/, '')} Compact ${c} / comfortable ${k}.`
    families.spacing.push({ name, value: v, usage })
  } else if (name.startsWith('tracking-')) {
    families.tracking.push({ name, value: rawLight, usage: usageFor(name) })
  } else if (name.startsWith('font-')) {
    fontFamilies[name.slice(5)] = rawLight
  } else {
    warn(`${name}: no token family for this name; skipped`)
  }
}

for (const [name] of dark) {
  if (!light.has(name)) warn(`${name} is set only in html.dark and has no light value; skipped`)
}

// Every token needs a hand-written note; the CSS comment is a fallback, not a substitute.
for (const fam of Object.values(families)) {
  for (const t of fam) if (!(t.name in notes)) warn(`notes.json has no usage note for ${t.name}`)
}
const seen = new Set()
for (const fam of Object.values(families)) {
  for (const t of fam) {
    if (seen.has(t.name)) warn(`duplicate token name ${t.name}`)
    seen.add(t.name)
  }
}
for (const t of families.color) {
  for (const v of typeof t.value === 'string' ? [t.value] : Object.values(t.value)) {
    const a = /^\{(.+)\}$/.exec(v)
    if (a && !colorNames.has(a[1])) warn(`${t.name} aliases ${a[1]}, which does not exist`)
  }
}

// --- 3. Fonts, assets, provenance ---------------------------------------------------------
const sha = execSync('git rev-parse --short HEAD', { cwd: repo }).toString().trim()
// A pull_request run checks out a detached merge commit, where rev-parse prints HEAD; the
// Actions variables then name the branch under review. Locally a detached checkout gets no
// branch name rather than a made-up one.
const gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repo }).toString().trim()
const branch =
  gitBranch !== 'HEAD'
    ? gitBranch
    : process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || ''
const ref = branch ? `${branch}@${sha}` : sha
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

// Start from an empty output folder, so a component, font or asset removed from the inputs
// does not survive from an earlier run into the tree README.md says to publish in full.
rmSync(dist, { recursive: true, force: true })
mkdirSync(join(dist, 'fonts'), { recursive: true })
const fonts = []
for (const f of sources.fonts) {
  const src = join(repo, f.src)
  if (!existsSync(src)) {
    warn(`font file missing: ${f.src}`)
    continue
  }
  const file = `fonts/${basename(f.src)}`
  cpSync(src, join(dist, file))
  fonts.push({ family: f.family, file, weight: f.weight, style: f.style })
}
if (sources.fontLicense)
  cpSync(join(repo, sources.fontLicense), join(dist, 'fonts', basename(sources.fontLicense)))

const assetGroups = {}
const groups = []
for (const [group, g] of Object.entries(sources.assets)) {
  groups.push(group)
  const files = {}
  const order = []
  for (const a of g.files) {
    const src = join(repo, a.src)
    if (!existsSync(src)) {
      warn(`asset missing: ${a.src}`)
      continue
    }
    // The upload record must describe these exact bytes: compare a digest of the file, not
    // its size, since a same-size edit is the common case for a redrawn image.
    const bytes = readFileSync(src)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (!a.sha256) {
      warn(`${a.src}: sources.json records no sha256 for this upload; add it (${sha256})`)
    } else if (sha256 !== a.sha256) {
      warn(
        `${a.src} has changed since it was uploaded (sha256 ${sha256.slice(0, 12)}…, recorded ${a.sha256.slice(0, 12)}…): upload it again and update blob, size and sha256`
      )
    }
    if (bytes.length !== a.size)
      warn(`${a.src} is ${bytes.length} bytes but sources.json records ${a.size}`)
    files[a.name] = { name: a.name, blob: a.blob, size: a.size, type: a.type }
    order.push(a.name)
    if (withAssets) {
      mkdirSync(join(dist, 'assets', group), { recursive: true })
      cpSync(src, join(dist, 'assets', group, a.name))
    }
  }
  assetGroups[group] = { name: group, tile: g.tile ?? 'l', order, files }
}

// --- 4. tokens.json -----------------------------------------------------------------------
const tokens = {
  name: sources.title,
  version: 1,
  meta: {
    source: 'github',
    repo: sources.repo,
    ref,
    package: '.',
    paths: {
      tokens: [sources.css],
      fonts: sources.fonts.map((f) => f.src),
      assets: Object.values(sources.assets).flatMap((g) => g.files.map((a) => a.src)),
      docs: sources.docs
    },
    components: sources.components,
    synced: now.slice(0, 10)
  },
  color: {
    themes: [
      { id: 'light', name: 'Light' },
      { id: 'dark', name: 'Dark' }
    ],
    tokens: families.color
  },
  shadow: { note: sources.familyNotes.shadow, tokens: families.shadow },
  spacing: { note: sources.familyNotes.spacing, tokens: families.spacing },
  radius: { note: sources.familyNotes.radius, tokens: families.radius },
  tracking: { note: sources.familyNotes.tracking, tokens: families.tracking },
  type: { fonts, families: fontFamilies, groups: typeStyles.groups }
}
writeFileSync(join(dist, 'tokens.json'), JSON.stringify(tokens, null, 2) + '\n')

// --- 5. Prose and previews, verbatim ------------------------------------------------------
const content = join(here, 'content')
cpSync(content, dist, { recursive: true })

// Every var(--x) a preview or README uses must be a token the page will declare.
const declared = new Set([...seen, ...Object.keys(fontFamilies).map((k) => `font-${k}`)])
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
  )
for (const file of walk(content)) {
  if (!/\.(html|md|css)$/.test(file)) continue
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/var\(--([A-Za-z0-9_.-]+)\)/g)) {
    if (!declared.has(m[1]))
      warn(`${relative(repo, file)} uses var(--${m[1]}), which no token declares`)
  }
  if (/\/preview\.html$/.test(file) && !/^<!-- @dsCard /.test(text))
    warn(`${relative(repo, file)}: line 1 must be the @dsCard marker`)
}
for (const comp of Object.keys(sources.components)) {
  for (const f of ['README.md', 'preview.html'])
    if (!existsSync(join(content, 'components', comp, f)))
      warn(`content/components/${comp}/${f} is missing`)
}
if (!existsSync(join(content, 'README.md'))) warn('content/README.md is missing')

// --- 6. The index -------------------------------------------------------------------------
const gitUser = (() => {
  try {
    return execSync('git config user.name', { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return ''
  }
})()
const by = argValue('--by') ?? (gitUser || 'Claude')
const index = {
  v: 3,
  layout: 'files',
  createdOnFiles: sources.createdOnFiles,
  title: sources.title,
  namespace: sources.namespace,
  libraries: [],
  sections: {},
  groups,
  assetGroups,
  blobs: {},
  docs: { readme: 'project/README.md', sections: [] },
  lastChange: {
    by,
    at: now,
    // `by` is whoever ran the build (git user.name or --by); `via` names the source commit.
    via: `${process.env.CI ? 'CI' : 'GitHub'} · ${sources.repo}@${sha}`,
    note: argValue('--note') ?? `rebuilt from ${ref}`
  }
}
writeFileSync(join(dist, 'design-system.json'), JSON.stringify(index, null, 2) + '\n')

// --- 7. Report ----------------------------------------------------------------------------
const count = (f) => families[f].length
console.log(
  `design-system: ${ref} → ${relative(repo, dist)}\n` +
    `  ${count('color')} colours in 2 themes, ${count('shadow')} shadows, ${count('spacing')} spacing, ` +
    `${count('radius')} radii, ${count('tracking')} tracking, ` +
    `${typeStyles.groups.reduce((n, g) => n + g.styles.length, 0)} text styles, ${fonts.length} fonts, ` +
    `${Object.keys(sources.components).length} components`
)
if (findings.length) {
  console.log(`  ${findings.length} finding(s):`)
  for (const f of findings) console.log(`  - ${f}`)
  if (check) process.exit(1)
} else {
  console.log('  no findings')
}
