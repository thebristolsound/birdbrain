// Runs the capture engine probe's off and on passes and compares what the page observed (D15 of
// docs/plans/2026-10-10-capture-engine-first-slice.md). The off pass loads the fixture with no CDP
// domain enabled; the on pass loads `about:blank`, enables Network, then loads it, as a background
// render does. It fails when `navigator.webdriver`, the `window.chrome` keys, the `Error.stack`
// getter count or the resource timing list differ between the passes, or when `history.length`
// differs by anything but the one entry the `about:blank` load adds (renderer spike, question 7).
// The 90 s fresh-window case of the probe spike does not run.
//
// Run from the repository root on Node 20, with a display:
//
//   xvfb-run --auto-servernum node scripts/capture-probe/run.mjs
//
// Expected output on stdout, on Electron 44.9.1, with exit 0. The versions line follows the
// installed build, and each pass logs its progress on stderr:
//
//   Electron 44.9.1, Chromium 152.0.7977.167
//   webdriver        off false  on false  same
//   chromeKeys       off []  on []  same
//   stackRead        off 0  on 0  same
//   resources        off ["/gz.txt","/img.png","/plain.txt","/redir"]  on ["/gz.txt","/img.png","/plain.txt","/redir"]  same
//   historyLength    off 1  on 2  one more on, from about:blank
//   No difference beyond the about:blank history entry.
//
// The script reproduces the hidden window's configuration, not the app's code.
import { spawnSync } from 'child_process'
import { createRequire } from 'module'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const require = createRequire(import.meta.url)
const electron = require('electron')
const main = join(import.meta.dirname, 'main.mjs')
const out = mkdtempSync(join(tmpdir(), 'capture-probe-'))

function runPass(name, extra) {
  const env = { ...process.env, PROBE_PASS: name, PROBE_OUT: out, ...extra }
  delete env.ELECTRON_RUN_AS_NODE
  const { status } = spawnSync(electron, ['--no-sandbox', main], { env, stdio: 'inherit' })
  if (status !== 0) throw new Error(`The ${name} pass exited ${status}`)
  return JSON.parse(readFileSync(join(out, `result-${name}.json`), 'utf8'))
}

let failed = false
try {
  const off = runPass('off', {})
  const on = runPass('on', { PROBE_BLANK_FIRST: '1' })
  console.log(`Electron ${on.versions.electron}, Chromium ${on.versions.chrome}`)
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  for (const fact of ['webdriver', 'chromeKeys', 'stackRead', 'resources', 'historyLength']) {
    const a = off.off.pageFacts[fact]
    const b = on.on.pageFacts[fact]
    let verdict
    if (fact === 'historyLength') {
      verdict = b === a + 1 ? 'one more on, from about:blank' : 'DIFFERENT'
    } else {
      verdict = same(a, b) ? 'same' : 'DIFFERENT'
    }
    if (verdict === 'DIFFERENT') failed = true
    console.log(`${fact.padEnd(16)} off ${JSON.stringify(a)}  on ${JSON.stringify(b)}  ${verdict}`)
  }
  console.log(
    failed
      ? 'The passes differ beyond the about:blank history entry.'
      : 'No difference beyond the about:blank history entry.'
  )
} finally {
  rmSync(out, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
