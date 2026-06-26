// Builds the standalone evidence-package verifier as a single Node SEA binary
// (#122 §9, Decision 1 + Decision 6).
//
// Pipeline:
//   1. esbuild bundles src/verifier/cli.ts + its deps (zod, @peculiar/asn1-*,
//      the verify-core) into ONE CommonJS file, resolving the @shared/* alias to
//      src/shared/*. The bundle is asserted to contain NO electron / src/main /
//      better-sqlite3 / keytar / hono import — the binary must be fs+crypto only.
//   2. node --experimental-sea-config produces a SEA blob.
//   3. The host `node` binary is copied and the blob is injected with postject.
//   4. Per-OS re-signing: macOS ad-hoc codesign, Windows signtool; Linux none.
//
// CROSS-BUILD LIMITATION (Decision 6): Node SEA emits a binary for the OS it
// runs on. This builds for the CURRENT OS only. A per-OS CI release matrix is
// out of scope and deferred to a follow-up issue.

import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const outDir = join(root, 'dist', 'verifier')
const bundlePath = join(outDir, 'cli.cjs')
const blobPath = join(outDir, 'sea-prep.blob')
const binaryName = process.platform === 'win32' ? 'birdbrain-verify.exe' : 'birdbrain-verify'
const binaryPath = join(outDir, binaryName)

const FORBIDDEN = [
  /require\(["']electron["']\)/,
  /require\(["']better-sqlite3["']\)/,
  /require\(["']keytar["']\)/,
  /require\(["']hono["']\)/,
  /["']\.\.?\/.*src\/main\//
]

function log(msg) {
  process.stdout.write(`[build-verifier] ${msg}\n`)
}

async function bundle() {
  log('bundling src/verifier/cli.ts with esbuild…')
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  await build({
    entryPoints: [join(root, 'src', 'verifier', 'cli.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    legalComments: 'none',
    alias: { '@shared': join(root, 'src', 'shared') }
  })
  // Bundle-safety guard: assert no forbidden runtime dep leaked in (§5, §13).
  const code = readFileSync(bundlePath, 'utf-8')
  const hits = FORBIDDEN.filter((re) => re.test(code))
  if (hits.length > 0) {
    throw new Error(
      `bundle contains forbidden imports (binary must be fs+crypto only): ${hits.map(String).join(', ')}`
    )
  }
  log(`bundle OK (${(code.length / 1024).toFixed(0)} KiB), no electron/main/native imports`)
}

function buildSeaBlob() {
  log('generating SEA blob (node --experimental-sea-config)…')
  execFileSync(process.execPath, ['--experimental-sea-config', join(root, 'sea-config.json')], {
    cwd: root,
    stdio: 'inherit'
  })
  if (!existsSync(blobPath)) throw new Error(`SEA blob not produced at ${blobPath}`)
}

function injectBlob() {
  log(`copying node executable -> ${binaryName}`)
  copyFileSync(process.execPath, binaryPath)
  chmodSync(binaryPath, 0o755)

  // On macOS/Windows the host binary is code-signed; injection invalidates that
  // signature, so we strip it first and re-sign after (§9). Linux needs neither.
  if (process.platform === 'darwin') {
    log('removing existing macOS signature before injection…')
    try {
      execFileSync('codesign', ['--remove-signature', binaryPath], { stdio: 'inherit' })
    } catch {
      log('codesign --remove-signature failed (continuing — binary may be unsigned)')
    }
  } else if (process.platform === 'win32') {
    log('removing existing Windows signature before injection…')
    try {
      execFileSync('signtool', ['remove', '/s', binaryPath], { stdio: 'inherit' })
    } catch {
      log('signtool remove failed (continuing — binary may be unsigned)')
    }
  }

  log('injecting SEA blob with postject…')
  const postject = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'postject.cmd' : 'postject')
  const args = [
    binaryPath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
  ]
  if (process.platform === 'darwin') {
    args.push('--macho-segment-name', 'NODE_SEA')
  }
  execFileSync(postject, args, { cwd: root, stdio: 'inherit' })

  if (process.platform === 'darwin') {
    log('re-signing macOS binary (ad-hoc)…')
    execFileSync('codesign', ['--sign', '-', binaryPath], { stdio: 'inherit' })
  } else if (process.platform === 'win32') {
    log('NOTE: re-sign the Windows .exe with a code-signing cert before distribution.')
  }
}

async function run() {
  await bundle()
  buildSeaBlob()
  injectBlob()
  log(`done. Binary: ${binaryPath}`)
  log(`run:  ${binaryName} <package-dir>   |   ${binaryName} --self-check`)
}

run().catch((err) => {
  process.stderr.write(`[build-verifier] FAILED: ${err.message}\n`)
  process.exit(1)
})
