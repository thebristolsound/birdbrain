# Asset origins and built package contents

**Status:** measured at `c2d730c8`, the tip of `main` when #1624 was worked and the merge base of
the change that adds this file. Each section prints the commands behind its figures; run them
against a later commit to refresh them.

**Scope:** acceptance criteria 2 and 3 of #265, which the maintainer's ruling of 2026-09-28
(posted on #265) split into #1624. Criteria 1, 5, and 6 of #265 stay with the maintainer:
contributor authority, what to do with material this walk cannot clear, and recording those calls.
The licence inventory, criterion 4, belongs to #1364.

**Not inspected:** the four pre-releases on `thebristolsound/birdbrain-releases`. They predate the
packaging allowlist, and inspecting them stays with the maintainer. "What the built packages
contain" inspects a local build made after the allowlist.

## Summary

- By #1624's definition, 170 tracked files count as binary at `c2d730c8`, three of them empty.
  125 are cleared and 45 need the maintainer. The 45 fall under eight of the ten items in "Needs
  the maintainer"; the other two items concern text files.
- Two committed images are full-page captures of a Reuters Institute article, including a Reuters
  photograph. Eleven design renders show that capture, and three standalone design pages pack it.
  Two uploads to the design project are screenshots of third-party products: one of Autopsy, one
  of Hunchly.
- The commits that added the Birdbrain logo, and the documents this walk searched, record neither
  who drew it nor on what terms. Twenty-two committed files are that artwork, a resize of it, or a
  byte-identical copy.
- Of the 14 files in `src/renderer/components/ui/`, `skeleton.tsx` and `tabs.tsx` were copied from
  shadcn/ui, nine follow shadcn/ui's component shape without its text, and three were written for
  this project. The repository carries no copy of shadcn/ui's MIT notice.
- A Linux package built from `c2d730c8` holds four top-level entries in `app.asar`, all inside
  `build.files`. Six of its 352 package folders under `node_modules` carry no licence file.
- The change that adds this file also puts the OFL-1.1 licence beside four committed font folders
  and adds a Security workflow check that fails when a tracked font folder has no licence file.
  The fifth folder, `extension/src/fonts/`, is to get its licence from #1363 (PR #1620); until
  that merges, the check reports it.

## Method

Each of the 170 files was traced to the commit that introduced it (`git log --diff-filter=A`),
compared byte for byte with its claimed source where one exists, and, for images, opened and
looked at. Each distinct image was opened once, so one file stands for each set of byte-identical
copies. The status column uses two values:

- `cleared`: the origin is on record, and the file is this project's own material or is under
  terms that allow redistribution, with the notice those terms require present in the repository.
- `needs the maintainer`: the origin or the terms are not on record, the file carries third-party
  material this walk cannot clear, or the terms require a notice the repository does not carry.

"Project material" means Birdbrain's own work under the repository's MIT licence, including renders
exported from the maintainer's claude.ai/design project. Whether that material is the maintainer's
to license is #265's contributor-authority question, which stays with him.

## Committed binary files

The count, as #1624 defines it:

```bash
BASE=c2d730c8
git ls-tree -r --name-only "$BASE" | wc -l   # 1511 tracked files
git grep -I -l -e '' "$BASE" | wc -l         # 1341 that git grep reads as text
```

1511 minus 1341 is 170. Three of the 170 are empty files: `git grep -e ''` matches no line in a
file that has none, so the subtraction counts them with the binaries. They have a row below so the
table reconciles. To list the 170:

```bash
git ls-tree -r --name-only "$BASE" | sort > /tmp/tracked.txt
git grep -I -l -e '' "$BASE" | sed "s/^$BASE://" | sort > /tmp/text.txt
comm -23 /tmp/tracked.txt /tmp/text.txt > /tmp/binary.txt
wc -l < /tmp/binary.txt   # 170
```

Two commands back the "byte-identical" claims in the table. Both read the working tree, so run
them on a checkout of `$BASE` after `pnpm install`. The first compares every tracked font with the
file of the same name in the installed `@fontsource-variable` packages, version 5.3.0 in
`pnpm-lock.yaml`, and prints `40 of 40`:

```bash
git ls-files '*.woff2' | node -e '
const fs = require("fs")
const fonts = fs.readFileSync(0, "utf8").split("\n").filter(Boolean)
let same = 0
for (const f of fonts) {
  const name = f.split("/").pop()
  const pkg = name.startsWith("jetbrains-mono-") ? "jetbrains-mono" : "inter"
  const upstream = "node_modules/@fontsource-variable/" + pkg + "/files/" + name
  if (fs.existsSync(upstream) && fs.readFileSync(f).equals(fs.readFileSync(upstream))) same++
  else console.log("differs: " + f)
}
console.log(same + " of " + fonts.length + " fonts match the package file of the same name")
'
```

The second groups the 170 files by content and prints 19 groups of identical files:

```bash
node -e '
const fs = require("fs")
const crypto = require("crypto")
const groups = new Map()
for (const f of fs.readFileSync("/tmp/binary.txt", "utf8").split("\n").filter(Boolean)) {
  const hash = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 12)
  groups.set(hash, [...(groups.get(hash) || []), f])
}
for (const [hash, files] of groups)
  if (files.length > 1) console.log(files.length + " " + hash + "\n  " + files.join("\n  "))
'
```

Thirteen of the groups are copies of the same font file. The other six are the 13 identical
placeholder renders in the 2026-08-10 bundle, `src/renderer/assets/logo.png` with its four copies,
`src/renderer/assets/extension-icon-48.png` with its four copies (one of them
`extension/icons/icon-48.png`), `resources/icon.png` with `resources/icon_nobg.png`,
`resources/icons/128x128.png` with `website/content/favicon.png`, and the three empty files.

| Files | Count | Origin | Terms | Status |
| --- | ---: | --- | --- | --- |
| `.design-sync/fonts/inter/files/*.woff2` | 7 | Byte-identical to `@fontsource-variable/inter` 5.3.0; `.design-sync/NOTES.md` records the copy. Added in 917f73a0 (#191) | SIL Open Font License 1.1, copyright 2016 The Inter Project Authors. `OFL.txt` beside them from #1624 | cleared |
| `.design-sync/fonts/jetbrains-mono/files/*.woff2` | 6 | Byte-identical to `@fontsource-variable/jetbrains-mono` 5.3.0. Added in 917f73a0 (#191) | OFL-1.1, copyright 2020 The JetBrains Mono Project Authors. `OFL.txt` beside them from #1624 | cleared |
| `docs/design-handoff/2026-09-14-design-project-export/_ds/birdbrain-ui-9632b0b0-024d-4a3c-94db-688afdd4768f/fonts/*.woff2` | 13 | Seven Inter and six JetBrains Mono files, byte-identical to the two packages; received in the design export, added in 89085808 | OFL-1.1, both copyright lines. `OFL.txt` beside them from #1624 | cleared |
| `docs/design-handoff/2026-09-19-shared-case-members/_ds/birdbrain-ui-9632b0b0-024d-4a3c-94db-688afdd4768f/fonts/*.woff2` | 13 | The same 13 files. Added in be4eb5af (#1503) | As in the previous row | cleared |
| `extension/src/fonts/inter-latin-wght-normal.woff2` | 1 | Byte-identical to `@fontsource-variable/inter` 5.3.0. Added in 41a753ef (#169) | OFL-1.1. No licence file beside it at `c2d730c8`; #1363 (PR #1620) would add one | needs the maintainer |
| `resources/icon.png`, `resources/icon_nobg.png` | 2 | The Birdbrain logo, 1024 pixels square; the two files are byte-identical. `icon.png` added in 733c4e7c and replaced in bb07ed11 ("update branding"), which added `icon_nobg.png`. No record of who drew it | Not on record | needs the maintainer |
| `resources/icons/*.png` | 7 | Resized from `resources/icon.png` by `scripts/gen-linux-icons.mjs`. Added in 592a1bcf | Follow the logo's | needs the maintainer |
| `extension/icons/*.png` | 3 | The logo at 16, 48, and 128 pixels square. Added in 6a778cf0 ("feature work") | Not on record | needs the maintainer |
| `src/renderer/assets/logo.png`, `src/renderer/assets/extension-icon-48.png` | 2 | The logo. `logo.png` added in bb07ed11; `extension-icon-48.png` added in e45eb869 (#177), byte-identical to `extension/icons/icon-48.png` | Not on record | needs the maintainer |
| `website/content/favicon.png` | 1 | Byte-identical to `resources/icons/128x128.png`. Added in 36a36fde | Not on record | needs the maintainer |
| `docs/design-handoff/2026-08-10-birdbrain-prototype/src/renderer/assets/*.png` (2), `docs/design-handoff/2026-09-14-design-project-export/src/renderer/assets/*.png` (2), `docs/design-handoff/2026-09-14-design-project-export/design_handoff_birdbrain_prototype/src/renderer/assets/*.png` (2), `docs/design-handoff/2026-09-19-shared-case-members/src/renderer/assets/logo.png` (1) | 7 | Byte-identical copies of the two `src/renderer/assets` files, received in the design bundles. Added in 8cfca5b6, 89085808, and be4eb5af (#1503) | Not on record | needs the maintainer |
| `docs/design-handoff/2026-08-10-birdbrain-prototype/screenshots/*.png` except `03-captures-list-viewer.png` | 21 | Renders of the claude.ai/design mock with its fictional case data; 13 are one identical placeholder render. Added in 8cfca5b6 | Project material | cleared |
| `docs/design-handoff/2026-08-10-birdbrain-prototype/screenshots/03-captures-list-viewer.png` | 1 | Mock render whose capture viewer shows the Reuters Institute capture of the `captured-page-slim.jpg` row. Added in 8cfca5b6 | Third-party material inside | needs the maintainer |
| `docs/design-handoff/2026-09-14-design-project-export/.thumbnail` | 1 | The design project's WebP thumbnail, a render of the mock's welcome card. Added in 89085808 | Project material | cleared |
| `docs/design-handoff/2026-09-14-design-project-export/captured-page-slim.jpg`, `docs/design-handoff/2026-09-14-design-project-export/pasted-1786076566546-0-msifvf7w-wjzq.png` | 2 | Full-page captures of a Reuters Institute (University of Oxford) article on how Bellingcat archives digital evidence of war crimes in Ukraine, dated February 21, 2023, including a photograph credited `REUTERS/Clodagh Kilcoyne`. The mock uses it as its sample capture. Added in 89085808 | Third-party; no licence on record | needs the maintainer |
| `docs/design-handoff/2026-09-14-design-project-export/design_handoff_birdbrain_prototype/screenshots/*.png` except 03, 12, and 13 | 11 | Mock renders with fictional data. Added in 89085808 | Project material | cleared |
| The same folder's `03-captures-list-viewer.png`, `12-tour-case-mark.png`, `13-captures-selection-bar.png` | 3 | Mock renders showing the Reuters Institute capture. Added in 89085808 | Third-party material inside | needs the maintainer |
| `docs/design-handoff/2026-09-14-design-project-export/screenshots/*.png` except `captures-narrow.png` | 5 | Design-side check renders with fictional data. Added in 89085808 | Project material | cleared |
| `docs/design-handoff/2026-09-14-design-project-export/screenshots/captures-narrow.png` | 1 | Check render showing the Reuters Institute capture. Added in 89085808 | Third-party material inside | needs the maintainer |
| `docs/design-handoff/2026-09-14-design-project-export/uploads/`: 17 `draw-*.png`, `Birdbrain-selection.png`, `Capture Viewer Redesign-selection.png`, `pasted-1786524749186-0.png`, `pasted-1786524755992-0.png` | 21 | Renders of the mock, some cropped and some marked up by hand, uploaded into the design project. Added in 89085808. The export's README counts 22 `draw-*.png` files; the folder holds 23 | Project material | cleared |
| The same folder's `draw-201b6ee2-4bbc-42a5-a05e-13d38a4efcdd.png`, `draw-62cdc1f0-3cb4-4db5-a53a-9fed84d80762.png`, `draw-69db88e7-9479-4f6f-b433-dd43660d7105.png`, `draw-92b25cf6-6948-463d-8631-a99da7bcfd2e.png`, `draw-a28f47f9-f261-4f96-bbd9-ebcb1990d110.png`, `draw-fff2aa9c-dc27-4855-9c06-925dc58737e8.png` | 6 | Annotated renders showing the Reuters Institute capture. Added in 89085808 | Third-party material inside | needs the maintainer |
| The same folder's `pasted-1785980228073-0.png` | 1 | Screenshot of Autopsy 3.0.0b3, a third-party forensic tool. Added in 89085808 | Third-party; no licence on record | needs the maintainer |
| The same folder's `pasted-1786142913073-0.png` | 1 | Screenshot of Hunchly 2.0, a third-party product, showing a Google page thumbnail. Added in 89085808 | Third-party; no licence on record | needs the maintainer |
| The same folder's `pasted-1786496337564-0.png` | 1 | A black curved-arrow drawing. No record of where it came from. Added in 89085808 | Not on record | needs the maintainer |
| The same folder's `pasted-1786096220328-0.png` | 1 | A capture of the mock that also shows a Windows Snipping Tool notification. Added in 89085808 | Project material, plus third-party interface text | needs the maintainer |
| `docs/design-handoff/2026-09-23-batch-3/*.png` | 5 | Screenshots of the app with fictional data, each added by the change it illustrates: 266ce8a1 (#1585), e4bb420a (#1584), 44a8ad2e (#1583), 71f62c55, 0b472876 | Project material | cleared |
| `resources/demo-case.birdbrain` | 1 | Generated by `scripts/build-demo-fixture.mjs` from the synthetic pages in `scripts/demo-fixture/pages/`. Added in b9869b57 | Project material | cleared |
| `tests/fixtures/timestamp/request.tsq` | 1 | The request Birdbrain's `buildTimestampRequest` produced, per `tests/fixtures/timestamp/README.md`. Added in ac40b476 (#136) | Project material | cleared |
| `tests/fixtures/timestamp/digicert-response.tsr`, `tests/fixtures/timestamp/digicert-token.der` | 2 | DigiCert's reply to that request from `http://timestamp.digicert.com`, and the token extracted from it, per the same README. Added in ac40b476 (#136) | No terms on record | needs the maintainer |
| `tests/fixtures/timestamp/identrust-response.tsr`, `identrust-response-2.tsr`, `sinpe-response.tsr` | 3 | Copied from `bellingcat/auto-archiver` `tests/data/timestamping` at `5a56b80`: their git blob ids equal upstream's `valid_timestamp.tsr`, `rfc3161-client-issue-104.tsr`, and `self_signed.tsr`. Added in 415e243c (#1153) | MIT, `Copyright (c) 2021 Stichting Bellingcat`. The repository does not carry that notice | needs the maintainer |
| `tests/shared/verify/fixtures/pre-scope-package/timestamps/843600c0-0768-40e5-8db5-026433ddd4af.tst` | 1 | Part of an evidence package this project's export wrote and froze; a synthetic token naming `tsa.example.com`, with no signer. Added in 911859d6 (#838) | Project material | cleared |
| `docs/archive/.gitkeep`, `.vale/styles/config/vocabularies/Birdbrain/reject.txt`, `website/public/.nojekyll` | 3 | Empty placeholder files, zero bytes each. Added in fc651224, ac4125ef (#693), and e73b6bbd (#276) | No content | cleared |
| `website/public/assets/*.png` | 16 | Generated by `e2e/readme-screenshots.spec.ts` from a seeded case whose pages are fictional (`website/content/docs/screenshots.mdx`). Added in e73b6bbd (#276) and 1431fff8 (#788) | Project material | cleared |

The rows add up to 170: 40 font files, 22 logo files, 81 design images, and 27 others. 125 are
cleared and 45 need the maintainer.

The auto-archiver blob ids can be checked against upstream with:

```bash
git rev-parse "$BASE:tests/fixtures/timestamp/identrust-response.tsr" \
  "$BASE:tests/fixtures/timestamp/identrust-response-2.tsr" \
  "$BASE:tests/fixtures/timestamp/sinpe-response.tsr"
gh api 'repos/bellingcat/auto-archiver/contents/tests/data/timestamping?ref=5a56b80' \
  --jq '.[] | .sha + " " + .name'
```

## Material inside text files

### Standalone design pages

`git grep -l -i woff2 "$BASE" -- 'docs/design-handoff/*.html'` lists 17 pages. Three of them pack
material. The other 14 match on one line each, a sample file entry in the mock's seed data that
the three packed pages also carry in their templates:

```bash
git grep -h -o -i -E "loc: '[^']*woff2'" "$BASE" -- 'docs/design-handoff/*.html' | sort | uniq -c
#   17 loc: 'https://fonts.gstatic.com/s/inter/v13/u.woff2'
```

The command used for bundled scripts finds the pages that carry a `__bundler/manifest` block, where
a packed page stores its fonts, scripts, and images base64-encoded:

```bash
git grep -l -F '__bundler/manifest' "$BASE" -- 'docs/design-handoff/*.html'
```

It lists the same three pages. No other tracked text file holds a long base64 run:

```bash
git grep -l -E '[A-Za-z0-9+/]{4000}' "$BASE"
```

This decodes each manifest and names every asset. Run it from the repository root after
`pnpm install`, with the working tree at `$BASE`:

```bash
git grep -l -F '__bundler/manifest' "$BASE" -- 'docs/design-handoff/*.html' | sed "s/^$BASE://" | node -e '
const fs = require("fs")
const zlib = require("zlib")
const crypto = require("crypto")
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex")
const known = new Map()
for (const pkg of ["inter", "jetbrains-mono"]) {
  const dir = "node_modules/@fontsource-variable/" + pkg + "/files/"
  for (const f of fs.readdirSync(dir)) known.set(sha(fs.readFileSync(dir + f)), "@fontsource-variable/" + pkg + " " + f)
}
for (const f of ["src/renderer/assets/logo.png", "src/renderer/assets/extension-icon-48.png",
  "docs/design-handoff/2026-09-14-design-project-export/captured-page-slim.jpg",
  "docs/design-handoff/2026-09-14-design-project-export/support.js"])
  known.set(sha(fs.readFileSync(f)), f)
for (const page of fs.readFileSync(0, "utf8").split("\n").filter(Boolean)) {
  const html = fs.readFileSync(page, "utf8")
  const manifest = JSON.parse(html.match(/<script type="__bundler\/manifest"[^>]*>([\s\S]*?)<\/script>/)[1])
  console.log(page)
  for (const { mime, compressed, data } of Object.values(manifest)) {
    let bytes = Buffer.from(data, "base64")
    if (compressed) bytes = zlib.gunzipSync(bytes)
    const text = mime.includes("javascript") ? bytes.toString("utf8") : ""
    const header = (text.match(/@license React\s*\*\s*(\S+)/) || [])[1]
    const version = (text.match(/"(18\.\d+\.\d+)"/) || [])[1]
    const what = known.get(sha(bytes)) || (header ? header + " " + version : text.split("\n")[0].slice(0, 60))
    console.log("  " + mime.padEnd(16) + String(bytes.length).padStart(7) + "  " + what)
  }
}
'
```

All three pages pack the same ten assets:

| Page | Fonts | Scripts | Images |
| --- | --- | --- | --- |
| `docs/design-handoff/2026-08-21-birdbrain-standalone/Birdbrain-standalone.html` | Four: the `latin` and `latin-ext` files of Inter Variable and of JetBrains Mono Variable, byte-identical to `@fontsource-variable` 5.3.0 | React 18.3.1 `react.production.min.js` and `react-dom.production.min.js`; the design tool's runtime, byte-identical to `support.js` | The logo and the extension icon; `captured-page-slim.jpg`, the Reuters Institute capture |
| `docs/design-handoff/2026-09-14-design-project-export/Birdbrain-standalone.html` | The same four | The same three | The same three |
| `docs/design-handoff/2026-09-14-design-project-export/Birdbrain.html` | The same four | The same three | The same three |

Each page's markup template also carries a Tailwind CSS v4.3.2 style sheet that keeps Tailwind's
one-line header, `/*! tailwindcss v4.3.2 | MIT License | https://tailwindcss.com */`.

Terms of the packed material:

- **Fonts:** OFL-1.1. None of the three pages carries the licence text or either copyright line.
  The next command counts 0 of each across the page, its template, and its decoded scripts.
- **React 18.3.1:** MIT. Each bundle keeps React's header, which names the copyright holder as
  Facebook, Inc. and its affiliates and points to a `LICENSE` file the page does not carry.
- **The design tool's runtime:** its first line begins
  `// GENERATED from dc-runtime/src/*.ts — do not edit.` The file states no copyright and no
  terms.
- **Images:** the logo rows and the Reuters Institute rows of the binary files table.

```bash
git grep -l -F '__bundler/manifest' "$BASE" -- 'docs/design-handoff/*.html' | sed "s/^$BASE://" | node -e '
const fs = require("fs")
const zlib = require("zlib")
for (const page of fs.readFileSync(0, "utf8").split("\n").filter(Boolean)) {
  const html = fs.readFileSync(page, "utf8")
  const manifest = JSON.parse(html.match(/<script type="__bundler\/manifest"[^>]*>([\s\S]*?)<\/script>/)[1])
  const template = JSON.parse(html.match(/<script type="__bundler\/template"[^>]*>([\s\S]*?)<\/script>/)[1])
  const texts = [html, template]
  for (const { mime, compressed, data } of Object.values(manifest)) {
    if (!mime.startsWith("text/")) continue
    let bytes = Buffer.from(data, "base64")
    if (compressed) bytes = zlib.gunzipSync(bytes)
    texts.push(bytes.toString("utf8"))
  }
  const all = texts.join("\n")
  const count = (re) => (all.match(re) || []).length
  console.log(page, count(/Open Font License/gi), count(/Inter Project Authors/g), count(/JetBrains Mono Project Authors/g))
}
'
```

### Other design material in text files

These sit outside the HTML list the acceptance criterion names, and are the same kind of material:

- **`support.js`**, eight copies of one file (git blob `cb009b69`) beside the `.dc.html` pages. It
  is the design tool's runtime. It names React 18.3.1, React DOM 18.3.1, and Babel standalone
  7.29.0 by their `unpkg.com` addresses; the three packed pages are the only tracked files that
  carry React itself. The runtime states no copyright and no terms.
- **`docs/design-handoff/2026-09-14-design-project-export/_ds/birdbrain-ui-9632b0b0-024d-4a3c-94db-688afdd4768f/_ds_bundle.js`**,
  a bundle of this project's `src/renderer/components/ui/` primitives with their dependencies:
  `motion` 12.42.2 (with `framer-motion` 12.42.2, `motion-dom` 12.42.2, and `motion-utils`
  12.39.0), `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.6.0, `radix-ui`
  1.6.1, and 14 `@radix-ui` packages, among them `@radix-ui/react-tabs` 1.1.16. The bundle carries
  no licence text. At the versions installed in this repository, which are the same packages at
  newer versions, the `license` field of each reads MIT, except that of
  `class-variance-authority`, which reads Apache-2.0.
- **`_ds_bundle.css`**, two copies of one file, in both design exports: Tailwind CSS v4.3.2 output
  with the same one-line header as the packed pages.

```bash
git ls-files -s 'docs/design-handoff/*support.js' | awk '{print $2}' | sort | uniq -c
git grep -h -o -E 'unpkg\.com/[^"]+' "$BASE" -- 'docs/design-handoff/2026-09-14-design-project-export/support.js'
node -e '
const s = require("fs").readFileSync(process.argv[1], "utf8")
const names = new Set([...s.matchAll(/\.pnpm\/((?:@[^+\/]+\+)?[^@\/]+@[0-9][^\/_"]*)/g)].map((m) => m[1]))
console.log([...names].sort().join("\n"))
' docs/design-handoff/2026-09-14-design-project-export/_ds/birdbrain-ui-9632b0b0-024d-4a3c-94db-688afdd4768f/_ds_bundle.js
```

## Vendored UI components

Evidence for each of the 14 files, taken at `$BASE`:

```bash
git log --follow --format='%h %ad %s' --date=short "$BASE" -- src/renderer/components/ui/<file>
git log -i --grep=shadcn --format='%h %ad %s' --date=short "$BASE" -- src/renderer/components/ui/
git grep -c data-slot "$BASE" -- src/renderer/components/ui/
git grep -n -E "from '(radix-ui|@radix-ui/[a-z-]+)'" "$BASE" -- src/renderer/components/ui/
```

Two commits in the history of that folder name shadcn: d090ed3e ("add shadcn Tabs primitive") and
390105d9 ("add shadcn Skeleton primitive"). Two files carry `data-slot` markers: `tabs.tsx` (4) and
`skeleton.tsx` (1). Two files import from `radix-ui`: `tabs.tsx` and `context-menu.tsx`. So at
`c2d730c8`, `skeleton.tsx` and `tabs.tsx` are the two files with both a history attribution and
`data-slot` markers.

Each file's first committed version was compared with the shadcn/ui source current when it
arrived:

| Local files | shadcn/ui source | Ref |
| --- | --- | --- |
| `badge`, `button`, `card`, `dialog`, `input`, `label`, `scroll-area`, `textarea` | `apps/www/registry/new-york/ui/<name>.tsx`, the `forwardRef` registry these files resemble | `84bd724d97`, its last state before shadcn/ui removed it in `2bfc1c82ba` on 2025-10-29 |
| `skeleton`, `tabs` | `apps/v4/registry/new-york-v4/ui/<name>.tsx` | `f31ed81983`, the last change to both before they arrived |
| `context-menu` | `apps/v4/registry/new-york-v4/ui/context-menu.tsx` | `8d6553a7f5` |
| `toaster` | `apps/v4/registry/new-york-v4/ui/sonner.tsx` | `8d6553a7f5` |

The Radix column reads the `new-york-v4` registry: at `c116b325ab`, the registry current when the
April 2026 files arrived, and at the refs in this table for the rest. Fetch an upstream file with
`gh api 'repos/shadcn-ui/ui/contents/<path>?ref=<ref>' --jq .content | base64 -d`, and a local
first version with `git show <commit>:src/renderer/components/ui/<file>`. The shared-lines figure
comes from this command, run on the two files:

```bash
node -e '
const fs = require("fs")
const lines = (f) => new Set(fs.readFileSync(f, "utf8").split("\n")
  .map((l) => l.trim().replace(/"/g, "\x27").replace(/[,;]+$/, "").replace(/\s+/g, " "))
  .filter((l) => l.length >= 16 && !l.startsWith("import ") && !l.startsWith("//") && !l.startsWith("*")))
const local = lines(process.argv[1])
const upstream = lines(process.argv[2])
console.log([...local].filter((l) => upstream.has(l)).length + " of " + local.size)
' <local-first-version> <upstream-file>
```

It counts the distinct lines of the local file that also appear upstream, after trimming,
collapsing spaces, turning double quotes into single quotes, and dropping trailing commas and
semicolons. It leaves out imports, comments, and lines shorter than 16 characters.

The classes:

- **Copied from shadcn/ui:** the first version is the upstream file, except the import alias
  (`@/lib/utils` became `@renderer/lib/utils`, the alias `components.json` sets) and, in
  `tabs.tsx`, a dropped `"use client"` line.
- **Similar in shape:** the file follows shadcn/ui's component anatomy (the same part names, `cn()`
  class merging, `forwardRef` with `displayName`, or `cva` variants) with this project's own class
  strings, markup, and behaviour. The shared lines are part names, structural lines, and exports.
- **Written for this project:** no shadcn/ui counterpart, or none of its text.

| File | Class | First commit | `data-slot` | Radix, here and in shadcn/ui | Shared lines |
| --- | --- | --- | ---: | --- | --- |
| `badge.tsx` | Similar in shape | abbe7a19, 2026-04-19, no shadcn attribution | 0 | This one uses no Radix, nor did the `forwardRef` badge; the `new-york-v4` badge builds on the Radix `Slot` | 3 of 16: the `cva` call, `defaultVariants`, the export |
| `button.tsx` | Similar in shape | f64fd962, 2026-04-11, no attribution | 0 | shadcn/ui's builds on the Radix `Slot`; this one renders a `motion.button` | 5 of 20: the `cva` call, `defaultVariants`, `variant: 'default'`, `displayName`, the export |
| `card.tsx` | Similar in shape | f64fd962 | 0 | Neither uses Radix | 6 of 21, all `displayName` lines |
| `context-menu.tsx` | Similar in shape | 623cf4cb, 2026-08-27 (#1085); the commit adopts `radix-ui`'s ContextMenu and names no shadcn source | 0 | Both build on Radix ContextMenu; shadcn/ui's carries 15 `data-slot` markers | 18 of 50: function names, Radix part tags, and export names. The class strings, the `danger` prop, and the header and footer parts are this project's |
| `dialog.tsx` | Similar in shape | f64fd962 | 0 | shadcn/ui's builds on Radix Dialog; this one draws its own overlay with `motion` and traps focus itself | 2 of 39, `displayName` lines |
| `index.ts` | Written for this project | f64fd962 | 0 | Not applicable: a file of re-exports | shadcn/ui ships no such file |
| `input.tsx` | Similar in shape | f64fd962 | 0 | Neither uses Radix | 2 of 5: `displayName`, the export |
| `label.tsx` | Similar in shape | f64fd962 | 0 | shadcn/ui's builds on Radix Label; this one is a plain `label` | 1 of 5: the export |
| `scroll-area.tsx` | Similar in shape | abbe7a19; its comment calls it a primitive "in the shadcn style" that is "Kept Radix-free" | 0 | shadcn/ui's builds on Radix ScrollArea; this one is a plain `div` | 0 of 7 |
| `section-label.tsx` | Written for this project | 903750a8, 2026-08-12, the design-handoff primitive patch | 0 | Not applicable | No shadcn/ui counterpart |
| `skeleton.tsx` | Copied from shadcn/ui | 390105d9, 2026-04-26, "add shadcn Skeleton primitive" | 1 | Neither uses Radix | 4 of 4. The first version differs from upstream only in the import alias, and the file has not changed since |
| `tabs.tsx` | Copied from shadcn/ui, changed since | d090ed3e, 2026-04-26, "add shadcn Tabs primitive" | 4 | Both build on Radix Tabs | 35 of 35 in the first version, which differs from upstream only in the import alias and the `"use client"` line. 0b472876 and e6f58842 changed it since; 23 of its 36 lines still match |
| `textarea.tsx` | Similar in shape | f64fd962 | 0 | Neither uses Radix | 2 of 5: `displayName`, the export |
| `toaster.tsx` | Written for this project | bca0032f, 2026-09-24 (#1578), built to the mock's toast | 0 | Neither uses Radix. It wraps `sonner`'s `Toaster`, as shadcn/ui's `sonner.tsx` does | 0 of 28 |

Terms: shadcn/ui is under the MIT licence, copyright (c) 2023 shadcn
(`gh api repos/shadcn-ui/ui/license`). The two copied files carry no notice, and the repository
holds no copy of shadcn/ui's licence. The maintainer's ruling on #1364 calls for one shadcn/ui
entry, with its MIT text, in a licence notice shipped with the packaged app; that notice would not
reach the source repository.

## What the built packages contain

### The build

A local build of `c2d730c8`, after the packaging allowlist of #1384: `build.files` is `out/**/*`,
`resources/**/*`, `package.json`, and `node_modules/**/*`. Built on 2026-09-28 (UTC) on Linux,
x86-64, with Node 20.20.2, pnpm 10.28.2, electron-builder 26.15.3, and Electron 44.4.5. The artifact
names carry `1.0.1-beta.21` because that is the `version` in `package.json` at `c2d730c8`. This is
not the published pre-release of that name, which predates the allowlist and is not inspected
here.

```bash
git switch --detach c2d730c8
pnpm install
pnpm package:linux
pnpm build:extension
mkdir -p dist && cd extension/dist && zip -r ../../dist/birdbrain-extension.zip . && cd ../..
rm -rf /tmp/bb-deb && dpkg-deb -x dist/birdbrain_1.0.1-beta.21_amd64.deb /tmp/bb-deb
R=/tmp/bb-deb/opt/Birdbrain/resources
```

The zip step is the one `.github/workflows/release.yml` runs. The listings below come from the
`.deb`. In this build, its `app.asar` had the same sha256 as the AppImage's and as
`dist/linux-unpacked/resources/app.asar`, and the AppImage's `resources/` held the same entries
except the Debian-only `apparmor-profile` and `package-type`.

### Top-level entries of app.asar

Read from the archive header with `node:fs`, the way #1362 read it:

```bash
node -e '
const fs = require("fs")
const fd = fs.openSync(process.argv[1], "r")
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const json = Buffer.alloc(head.readUInt32LE(12))
fs.readSync(fd, json, 0, json.length, 16)
const root = JSON.parse(json.toString("utf8"))
const files = []
const walk = (node, at) => {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const path = at ? at + "/" + name : name
    if (entry.files) walk(entry, path)
    else files.push({ path, unpacked: Boolean(entry.unpacked) })
  }
}
walk(root, "")
console.log("top-level entries of app.asar (entry, kind, files, of which unpacked):")
for (const [name, entry] of Object.entries(root.files)) {
  const mine = files.filter((f) => f.path === name || f.path.startsWith(name + "/"))
  const kind = entry.files ? "folder" : "file"
  console.log("  " + [name, kind, mine.length, mine.filter((f) => f.unpacked).length].join("  "))
}
console.log("files in the archive: " + files.length + ", unpacked: " + files.filter((f) => f.unpacked).length)
const allowed = /^(out\/|resources\/|node_modules\/|package\.json$)/
const outside = files.filter((f) => !allowed.test(f.path))
console.log("paths outside build.files: " + (outside.length ? outside.map((f) => f.path).join(", ") : "none"))
console.log("files outside node_modules/:")
for (const f of files) if (!f.path.startsWith("node_modules/")) console.log("  " + f.path)
' "$R/app.asar"
```

```text
top-level entries of app.asar (entry, kind, files, of which unpacked):
  node_modules  folder  13430  112
  out  folder  21  0
  package.json  file  1  0
  resources  folder  9  0
files in the archive: 13461, unpacked: 112
paths outside build.files: none
files outside node_modules/:
  out/main/index.js
  out/preload/index.js
  out/renderer/assets/extension-icon-48-Cxt1CE5b.png
  out/renderer/assets/index-DZbN4P6C.css
  out/renderer/assets/index-XDSHrrcz.js
  out/renderer/assets/inter-cyrillic-ext-wght-normal-BOeWTOD4.woff2
  out/renderer/assets/inter-cyrillic-wght-normal-DqGufNeO.woff2
  out/renderer/assets/inter-greek-ext-wght-normal-DlzME5K_.woff2
  out/renderer/assets/inter-greek-wght-normal-CkhJZR-_.woff2
  out/renderer/assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2
  out/renderer/assets/inter-latin-wght-normal-Dx4kXJAl.woff2
  out/renderer/assets/inter-vietnamese-wght-normal-CBcvBZtf.woff2
  out/renderer/assets/jetbrains-mono-cyrillic-ext-wght-normal-EocZY2iu.woff2
  out/renderer/assets/jetbrains-mono-cyrillic-wght-normal-D73BlboJ.woff2
  out/renderer/assets/jetbrains-mono-greek-wght-normal-Bw9x6K1M.woff2
  out/renderer/assets/jetbrains-mono-latin-ext-wght-normal-DBQx-q_a.woff2
  out/renderer/assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2
  out/renderer/assets/jetbrains-mono-vietnamese-wght-normal-Bt-aOZkq.woff2
  out/renderer/assets/logo-65E_Zahx.png
  out/renderer/index.html
  out/renderer/theme-init.js
  package.json
  resources/icon.png
  resources/icon_nobg.png
  resources/icons/128x128.png
  resources/icons/16x16.png
  resources/icons/256x256.png
  resources/icons/32x32.png
  resources/icons/48x48.png
  resources/icons/512x512.png
  resources/icons/64x64.png
```

### Paths outside build.files

None. The command in the previous section tests every path in the archive against `out/`,
`resources/`, `node_modules/`, and `package.json`, and prints `none`.

### The app.asar.unpacked tree

```bash
find "$R/app.asar.unpacked" -type f | sed "s|^$R/||" | sort
```

```text
app.asar.unpacked/node_modules/better-sqlite3/build/deps/sqlite3.Makefile
app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node
app.asar.unpacked/node_modules/better-sqlite3/build/Release/obj/gen/sqlite3/sqlite3.c
app.asar.unpacked/node_modules/better-sqlite3/build/Release/obj/gen/sqlite3/sqlite3ext.h
app.asar.unpacked/node_modules/better-sqlite3/build/Release/obj/gen/sqlite3/sqlite3.h
app.asar.unpacked/node_modules/better-sqlite3/build/Release/test_extension.node
app.asar.unpacked/node_modules/better-sqlite3/deps/common.gypi
app.asar.unpacked/node_modules/better-sqlite3/deps/copy.js
app.asar.unpacked/node_modules/better-sqlite3/deps/defines.gypi
app.asar.unpacked/node_modules/better-sqlite3/deps/download.sh
app.asar.unpacked/node_modules/better-sqlite3/deps/patches/1208.patch
app.asar.unpacked/node_modules/better-sqlite3/deps/sqlite3.gyp
app.asar.unpacked/node_modules/better-sqlite3/deps/sqlite3/sqlite3.c
app.asar.unpacked/node_modules/better-sqlite3/deps/sqlite3/sqlite3ext.h
app.asar.unpacked/node_modules/better-sqlite3/deps/sqlite3/sqlite3.h
app.asar.unpacked/node_modules/better-sqlite3/deps/test_extension.c
app.asar.unpacked/node_modules/better-sqlite3/lib/database.js
app.asar.unpacked/node_modules/better-sqlite3/lib/index.js
app.asar.unpacked/node_modules/better-sqlite3/lib/methods/aggregate.js
app.asar.unpacked/node_modules/better-sqlite3/lib/methods/backup.js
app.asar.unpacked/node_modules/better-sqlite3/lib/methods/function.js
app.asar.unpacked/node_modules/better-sqlite3/lib/methods/inspect.js
app.asar.unpacked/node_modules/better-sqlite3/lib/methods/pragma.js
app.asar.unpacked/node_modules/better-sqlite3/lib/methods/serialize.js
app.asar.unpacked/node_modules/better-sqlite3/lib/methods/table.js
app.asar.unpacked/node_modules/better-sqlite3/lib/methods/transaction.js
app.asar.unpacked/node_modules/better-sqlite3/lib/methods/wrappers.js
app.asar.unpacked/node_modules/better-sqlite3/lib/sqlite-error.js
app.asar.unpacked/node_modules/better-sqlite3/lib/util.js
app.asar.unpacked/node_modules/better-sqlite3/LICENSE
app.asar.unpacked/node_modules/better-sqlite3/package.json
app.asar.unpacked/node_modules/better-sqlite3/src/addon.cpp
app.asar.unpacked/node_modules/better-sqlite3/src/better_sqlite3.cpp
app.asar.unpacked/node_modules/better-sqlite3/src/objects/backup.cpp
app.asar.unpacked/node_modules/better-sqlite3/src/objects/backup.hpp
app.asar.unpacked/node_modules/better-sqlite3/src/objects/database.cpp
app.asar.unpacked/node_modules/better-sqlite3/src/objects/database.hpp
app.asar.unpacked/node_modules/better-sqlite3/src/objects/statement.cpp
app.asar.unpacked/node_modules/better-sqlite3/src/objects/statement.hpp
app.asar.unpacked/node_modules/better-sqlite3/src/objects/statement-iterator.cpp
app.asar.unpacked/node_modules/better-sqlite3/src/objects/statement-iterator.hpp
app.asar.unpacked/node_modules/better-sqlite3/src/util/binder.cpp
app.asar.unpacked/node_modules/better-sqlite3/src/util/bind-map.cpp
app.asar.unpacked/node_modules/better-sqlite3/src/util/constants.cpp
app.asar.unpacked/node_modules/better-sqlite3/src/util/custom-aggregate.cpp
app.asar.unpacked/node_modules/better-sqlite3/src/util/custom-function.cpp
app.asar.unpacked/node_modules/better-sqlite3/src/util/custom-table.cpp
app.asar.unpacked/node_modules/better-sqlite3/src/util/data-converter.cpp
app.asar.unpacked/node_modules/better-sqlite3/src/util/data.cpp
app.asar.unpacked/node_modules/better-sqlite3/src/util/helpers.cpp
app.asar.unpacked/node_modules/better-sqlite3/src/util/macros.cpp
app.asar.unpacked/node_modules/better-sqlite3/src/util/query-macros.cpp
app.asar.unpacked/node_modules/better-sqlite3/src/util/row-builder.cpp
app.asar.unpacked/node_modules/@img/colour/color.cjs
app.asar.unpacked/node_modules/@img/colour/index.cjs
app.asar.unpacked/node_modules/@img/colour/LICENSE.md
app.asar.unpacked/node_modules/@img/colour/package.json
app.asar.unpacked/node_modules/@img/sharp-libvips-linux-arm64/lib/glib-2.0/include/glibconfig.h
app.asar.unpacked/node_modules/@img/sharp-libvips-linux-arm64/lib/index.js
app.asar.unpacked/node_modules/@img/sharp-libvips-linux-arm64/lib/libvips-cpp.so.8.18.6
app.asar.unpacked/node_modules/@img/sharp-libvips-linux-arm64/package.json
app.asar.unpacked/node_modules/@img/sharp-libvips-linux-arm64/versions.json
app.asar.unpacked/node_modules/@img/sharp-libvips-linux-x64/lib/glib-2.0/include/glibconfig.h
app.asar.unpacked/node_modules/@img/sharp-libvips-linux-x64/lib/index.js
app.asar.unpacked/node_modules/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.8.18.6
app.asar.unpacked/node_modules/@img/sharp-libvips-linux-x64/package.json
app.asar.unpacked/node_modules/@img/sharp-libvips-linux-x64/versions.json
app.asar.unpacked/node_modules/@img/sharp-linux-arm64/index.cjs
app.asar.unpacked/node_modules/@img/sharp-linux-arm64/lib/sharp-linux-arm64-0.35.4.node
app.asar.unpacked/node_modules/@img/sharp-linux-arm64/LICENSE
app.asar.unpacked/node_modules/@img/sharp-linux-arm64/package.json
app.asar.unpacked/node_modules/@img/sharp-linux-x64/index.cjs
app.asar.unpacked/node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64-0.35.4.node
app.asar.unpacked/node_modules/@img/sharp-linux-x64/LICENSE
app.asar.unpacked/node_modules/@img/sharp-linux-x64/package.json
app.asar.unpacked/node_modules/sharp/dist/channel.cjs
app.asar.unpacked/node_modules/sharp/dist/channel.mjs
app.asar.unpacked/node_modules/sharp/dist/colour.cjs
app.asar.unpacked/node_modules/sharp/dist/colour.mjs
app.asar.unpacked/node_modules/sharp/dist/composite.cjs
app.asar.unpacked/node_modules/sharp/dist/composite.mjs
app.asar.unpacked/node_modules/sharp/dist/constructor.cjs
app.asar.unpacked/node_modules/sharp/dist/constructor.mjs
app.asar.unpacked/node_modules/sharp/dist/index.cjs
app.asar.unpacked/node_modules/sharp/dist/index.d.cts
app.asar.unpacked/node_modules/sharp/dist/index.d.mts
app.asar.unpacked/node_modules/sharp/dist/index.mjs
app.asar.unpacked/node_modules/sharp/dist/input.cjs
app.asar.unpacked/node_modules/sharp/dist/input.mjs
app.asar.unpacked/node_modules/sharp/dist/is.cjs
app.asar.unpacked/node_modules/sharp/dist/is.mjs
app.asar.unpacked/node_modules/sharp/dist/libvips.cjs
app.asar.unpacked/node_modules/sharp/dist/libvips.mjs
app.asar.unpacked/node_modules/sharp/dist/operation.cjs
app.asar.unpacked/node_modules/sharp/dist/operation.mjs
app.asar.unpacked/node_modules/sharp/dist/output.cjs
app.asar.unpacked/node_modules/sharp/dist/output.mjs
app.asar.unpacked/node_modules/sharp/dist/resize.cjs
app.asar.unpacked/node_modules/sharp/dist/resize.mjs
app.asar.unpacked/node_modules/sharp/dist/sharp.cjs
app.asar.unpacked/node_modules/sharp/dist/sharp.mjs
app.asar.unpacked/node_modules/sharp/dist/utility.cjs
app.asar.unpacked/node_modules/sharp/dist/utility.mjs
app.asar.unpacked/node_modules/sharp/install/build.js
app.asar.unpacked/node_modules/sharp/LICENSE
app.asar.unpacked/node_modules/sharp/package.json
app.asar.unpacked/node_modules/sharp/src/common.h
app.asar.unpacked/node_modules/sharp/src/metadata.h
app.asar.unpacked/node_modules/sharp/src/operations.h
app.asar.unpacked/node_modules/sharp/src/pipeline.h
app.asar.unpacked/node_modules/sharp/src/stats.h
app.asar.unpacked/node_modules/sharp/src/utilities.h
```

### The installed resources folder

```bash
find "$R" -path "$R/app.asar.unpacked" -prune -o -print | sed "s|^$R|resources|" | sort
```

```text
resources
resources/apparmor-profile
resources/app.asar
resources/app-update.yml
resources/demo-case.birdbrain
resources/extension
resources/extension/assets
resources/extension/assets/options.css
resources/extension/assets/popup.css
resources/extension/background.js
resources/extension/chunks
resources/extension/chunks/api.js
resources/extension/chunks/theme.js
resources/extension/content.js
resources/extension/fonts
resources/extension/fonts/fonts.css
resources/extension/fonts/inter-latin-wght-normal.woff2
resources/extension/icons
resources/extension/icons/icon-128.png
resources/extension/icons/icon-16.png
resources/extension/icons/icon-48.png
resources/extension/manifest.json
resources/extension/options.html
resources/extension/options.js
resources/extension/popup.html
resources/extension/popup.js
resources/extension/theme-preinit.js
resources/package-type
```

### Package folders under `node_modules`

A package folder is a folder, not starting with a dot, directly under a `node_modules` folder or
under a scope folder inside one. A licence file is a file at the package folder's root whose name
starts with `LICENSE`, `LICENCE` or `COPYING`, in any case.

```bash
node -e '
const fs = require("fs")
const fd = fs.openSync(process.argv[1], "r")
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const json = Buffer.alloc(head.readUInt32LE(12))
fs.readSync(fd, json, 0, json.length, 16)
const root = JSON.parse(json.toString("utf8"))
const licence = /^(licen[cs]e|copying)/i
const rows = []
const walk = (node, at) => {
  for (const [name, entry] of Object.entries(node.files || {})) {
    if (!entry.files) continue
    const path = at + "/" + name
    const parts = path.split("/")
    const isPackage =
      (parts.at(-2) === "node_modules" && !name.startsWith("@") && !name.startsWith(".")) ||
      (parts.at(-3) === "node_modules" && parts.at(-2).startsWith("@"))
    if (isPackage) {
      const found = Object.keys(entry.files).filter((f) => !entry.files[f].files && licence.test(f))
      rows.push((found.length ? "yes " : "no  ") + path.slice(1) + (found.length ? "  " + found.join(" ") : ""))
    }
    walk(entry, path)
  }
}
walk(root, "")
const without = rows.filter((r) => r.startsWith("no"))
console.log("package folders: " + rows.length + ", with a licence file: " + (rows.length - without.length) + ", without: " + without.length)
for (const r of rows) console.log(r)
' "$R/app.asar"
```

```text
package folders: 352, with a licence file: 346, without: 6
yes node_modules/@floating-ui/core  LICENSE
yes node_modules/@floating-ui/dom  LICENSE
yes node_modules/@floating-ui/react-dom  LICENSE
yes node_modules/@floating-ui/utils  LICENSE
yes node_modules/@fontsource-variable/inter  LICENSE
yes node_modules/@fontsource-variable/jetbrains-mono  LICENSE
yes node_modules/@ghostery/adblocker  LICENSE
yes node_modules/@ghostery/adblocker-content  LICENSE
yes node_modules/@ghostery/adblocker-electron  LICENSE
yes node_modules/@ghostery/adblocker-electron-preload  LICENSE
yes node_modules/@ghostery/adblocker-extended-selectors  LICENSE
yes node_modules/@ghostery/url-parser  LICENSE
yes node_modules/@hono/node-server  LICENSE
no  node_modules/@hono/zod-validator
yes node_modules/@img/colour  LICENSE.md
no  node_modules/@img/sharp-libvips-linux-arm64
no  node_modules/@img/sharp-libvips-linux-x64
yes node_modules/@img/sharp-linux-arm64  LICENSE
yes node_modules/@img/sharp-linux-x64  LICENSE
yes node_modules/@peculiar/asn1-cms  LICENSE
yes node_modules/@peculiar/asn1-schema  LICENSE
yes node_modules/@peculiar/asn1-tsp  LICENSE
yes node_modules/@peculiar/asn1-x509  LICENSE
yes node_modules/@peculiar/asn1-x509-attr  LICENSE
yes node_modules/@peculiar/utils  LICENSE
yes node_modules/@radix-ui/number  LICENSE
yes node_modules/@radix-ui/primitive  LICENSE
yes node_modules/@radix-ui/react-accessible-icon  LICENSE
yes node_modules/@radix-ui/react-accordion  LICENSE
yes node_modules/@radix-ui/react-alert-dialog  LICENSE
yes node_modules/@radix-ui/react-arrow  LICENSE
yes node_modules/@radix-ui/react-aspect-ratio  LICENSE
yes node_modules/@radix-ui/react-avatar  LICENSE
yes node_modules/@radix-ui/react-checkbox  LICENSE
yes node_modules/@radix-ui/react-collapsible  LICENSE
yes node_modules/@radix-ui/react-collection  LICENSE
yes node_modules/@radix-ui/react-compose-refs  LICENSE
yes node_modules/@radix-ui/react-context  LICENSE
yes node_modules/@radix-ui/react-context-menu  LICENSE
yes node_modules/@radix-ui/react-dialog  LICENSE
yes node_modules/@radix-ui/react-direction  LICENSE
yes node_modules/@radix-ui/react-dismissable-layer  LICENSE
yes node_modules/@radix-ui/react-dropdown-menu  LICENSE
yes node_modules/@radix-ui/react-focus-guards  LICENSE
yes node_modules/@radix-ui/react-focus-scope  LICENSE
yes node_modules/@radix-ui/react-form  LICENSE
yes node_modules/@radix-ui/react-hover-card  LICENSE
yes node_modules/@radix-ui/react-id  LICENSE
yes node_modules/@radix-ui/react-label  LICENSE
yes node_modules/@radix-ui/react-menu  LICENSE
yes node_modules/@radix-ui/react-menubar  LICENSE
yes node_modules/@radix-ui/react-navigation-menu  LICENSE
yes node_modules/@radix-ui/react-one-time-password-field  LICENSE
yes node_modules/@radix-ui/react-password-toggle-field  LICENSE
yes node_modules/@radix-ui/react-popover  LICENSE
yes node_modules/@radix-ui/react-popper  LICENSE
yes node_modules/@radix-ui/react-portal  LICENSE
yes node_modules/@radix-ui/react-presence  LICENSE
yes node_modules/@radix-ui/react-primitive  LICENSE
yes node_modules/@radix-ui/react-progress  LICENSE
yes node_modules/@radix-ui/react-radio-group  LICENSE
yes node_modules/@radix-ui/react-roving-focus  LICENSE
yes node_modules/@radix-ui/react-scroll-area  LICENSE
yes node_modules/@radix-ui/react-select  LICENSE
yes node_modules/@radix-ui/react-separator  LICENSE
yes node_modules/@radix-ui/react-slider  LICENSE
yes node_modules/@radix-ui/react-slot  LICENSE
yes node_modules/@radix-ui/react-switch  LICENSE
yes node_modules/@radix-ui/react-tabs  LICENSE
yes node_modules/@radix-ui/react-toast  LICENSE
yes node_modules/@radix-ui/react-toggle  LICENSE
yes node_modules/@radix-ui/react-toggle-group  LICENSE
yes node_modules/@radix-ui/react-toolbar  LICENSE
yes node_modules/@radix-ui/react-tooltip  LICENSE
yes node_modules/@radix-ui/react-use-callback-ref  LICENSE
yes node_modules/@radix-ui/react-use-controllable-state  LICENSE
yes node_modules/@radix-ui/react-use-effect-event  LICENSE
yes node_modules/@radix-ui/react-use-escape-keydown  LICENSE
yes node_modules/@radix-ui/react-use-is-hydrated  LICENSE
yes node_modules/@radix-ui/react-use-layout-effect  LICENSE
yes node_modules/@radix-ui/react-use-previous  LICENSE
yes node_modules/@radix-ui/react-use-rect  LICENSE
yes node_modules/@radix-ui/react-use-size  LICENSE
yes node_modules/@radix-ui/react-visually-hidden  LICENSE
yes node_modules/@radix-ui/rect  LICENSE
yes node_modules/@remusao/guess-url-type  LICENSE
yes node_modules/@remusao/small  LICENSE
yes node_modules/@remusao/smaz  LICENSE
yes node_modules/@remusao/smaz-compress  LICENSE
yes node_modules/@remusao/smaz-decompress  LICENSE
yes node_modules/@remusao/trie  LICENSE
yes node_modules/@tanstack/history  LICENSE
yes node_modules/@tanstack/query-core  LICENSE
yes node_modules/@tanstack/react-query  LICENSE
yes node_modules/@tanstack/react-router  LICENSE
yes node_modules/@tanstack/react-store  LICENSE
yes node_modules/@tanstack/router-core  LICENSE
yes node_modules/@tanstack/store  LICENSE
yes node_modules/@tiptap/core  LICENSE.md
yes node_modules/@tiptap/extension-blockquote  LICENSE.md
yes node_modules/@tiptap/extension-bold  LICENSE.md
yes node_modules/@tiptap/extension-bubble-menu  LICENSE.md
yes node_modules/@tiptap/extension-bullet-list  LICENSE.md
yes node_modules/@tiptap/extension-code  LICENSE.md
yes node_modules/@tiptap/extension-code-block  LICENSE.md
yes node_modules/@tiptap/extension-document  LICENSE.md
yes node_modules/@tiptap/extension-dropcursor  LICENSE.md
yes node_modules/@tiptap/extension-floating-menu  LICENSE.md
yes node_modules/@tiptap/extension-gapcursor  LICENSE.md
yes node_modules/@tiptap/extension-hard-break  LICENSE.md
yes node_modules/@tiptap/extension-heading  LICENSE.md
yes node_modules/@tiptap/extension-horizontal-rule  LICENSE.md
yes node_modules/@tiptap/extension-italic  LICENSE.md
yes node_modules/@tiptap/extension-link  LICENSE.md
yes node_modules/@tiptap/extension-list  LICENSE.md
yes node_modules/@tiptap/extension-list-item  LICENSE.md
yes node_modules/@tiptap/extension-list-keymap  LICENSE.md
yes node_modules/@tiptap/extension-ordered-list  LICENSE.md
yes node_modules/@tiptap/extension-paragraph  LICENSE.md
yes node_modules/@tiptap/extension-strike  LICENSE.md
yes node_modules/@tiptap/extension-text  LICENSE.md
yes node_modules/@tiptap/extension-underline  LICENSE.md
yes node_modules/@tiptap/extensions  LICENSE.md
yes node_modules/@tiptap/pm  LICENSE
yes node_modules/@tiptap/react  LICENSE.md
yes node_modules/@tiptap/starter-kit  LICENSE.md
yes node_modules/@tiptap/static-renderer  LICENSE.md
yes node_modules/@tiptap/suggestion  LICENSE.md
yes node_modules/@types/debug  LICENSE
yes node_modules/@types/estree  LICENSE
yes node_modules/@types/estree-jsx  LICENSE
yes node_modules/@types/hast  LICENSE
yes node_modules/@types/mdast  LICENSE
yes node_modules/@types/ms  LICENSE
yes node_modules/@types/react-reconciler  LICENSE
yes node_modules/@types/unist  LICENSE
yes node_modules/@types/use-sync-external-store  LICENSE
yes node_modules/@ungap/structured-clone  LICENSE
yes node_modules/argparse  LICENSE
yes node_modules/aria-hidden  LICENSE
yes node_modules/asn1js  LICENSE
yes node_modules/bail  license
yes node_modules/base64-js  LICENSE
yes node_modules/better-sqlite3  LICENSE
yes node_modules/bindings  LICENSE.md
yes node_modules/bl  LICENSE.md
no  node_modules/boolbase
yes node_modules/buffer  LICENSE
yes node_modules/builder-util-runtime  LICENSE
yes node_modules/ccount  license
yes node_modules/character-entities  license
yes node_modules/character-entities-html4  license
yes node_modules/character-entities-legacy  license
yes node_modules/character-reference-invalid  license
yes node_modules/cheerio  LICENSE
yes node_modules/cheerio-select  LICENSE
yes node_modules/chownr  LICENSE
yes node_modules/class-variance-authority  LICENSE
yes node_modules/clsx  license
yes node_modules/comma-separated-tokens  license
yes node_modules/cookie-es  LICENSE
yes node_modules/css-select  LICENSE
yes node_modules/css-what  LICENSE
yes node_modules/debug  LICENSE
yes node_modules/decode-named-character-reference  license
yes node_modules/decompress-response  license
yes node_modules/deep-extend  LICENSE
yes node_modules/dequal  license
yes node_modules/detect-libc  LICENSE
yes node_modules/detect-node-es  LICENSE
yes node_modules/devlop  license
yes node_modules/dom-serializer  LICENSE
yes node_modules/dom-serializer/node_modules/entities  LICENSE
yes node_modules/domelementtype  LICENSE
yes node_modules/domhandler  LICENSE
yes node_modules/domutils  LICENSE
yes node_modules/electron-updater  LICENSE
yes node_modules/electron-updater/node_modules/semver  LICENSE
yes node_modules/encoding-sniffer  LICENSE
yes node_modules/end-of-stream  LICENSE
yes node_modules/entities  LICENSE
yes node_modules/estree-util-is-identifier-name  license
yes node_modules/expand-template  LICENSE
yes node_modules/extend  LICENSE
yes node_modules/fast-equals  LICENSE
yes node_modules/file-uri-to-path  LICENSE
yes node_modules/framer-motion  LICENSE.md
yes node_modules/fs-constants  LICENSE
yes node_modules/fs-extra  LICENSE
yes node_modules/get-nonce  LICENSE
yes node_modules/get-stdin  license
yes node_modules/github-from-package  LICENSE
yes node_modules/graceful-fs  LICENSE
yes node_modules/hast-util-to-jsx-runtime  license
yes node_modules/hast-util-whitespace  license
yes node_modules/hono  LICENSE
yes node_modules/html-url-attributes  license
yes node_modules/htmlparser2  LICENSE
yes node_modules/htmlparser2/node_modules/entities  LICENSE
yes node_modules/iconv-lite  LICENSE
yes node_modules/ieee754  LICENSE
yes node_modules/inherits  LICENSE
yes node_modules/ini  LICENSE
yes node_modules/inline-style-parser  LICENSE
yes node_modules/ioc-extractor  LICENSE
yes node_modules/is-alphabetical  license
yes node_modules/is-alphanumerical  license
yes node_modules/is-decimal  license
yes node_modules/is-hexadecimal  license
yes node_modules/is-plain-obj  license
yes node_modules/isbot  LICENSE
yes node_modules/its-fine  LICENSE
yes node_modules/its-fine/node_modules/@types/react-reconciler  LICENSE
yes node_modules/js-yaml  LICENSE
yes node_modules/jsonfile  LICENSE
yes node_modules/konva  LICENSE
no  node_modules/lazy-val
yes node_modules/linkifyjs  LICENSE
yes node_modules/lodash.escaperegexp  LICENSE
yes node_modules/lodash.isequal  LICENSE
yes node_modules/longest-streak  license
yes node_modules/lucide-react  LICENSE
yes node_modules/mdast-util-from-markdown  license
yes node_modules/mdast-util-mdx-expression  license
yes node_modules/mdast-util-mdx-jsx  license
yes node_modules/mdast-util-mdxjs-esm  license
yes node_modules/mdast-util-phrasing  license
yes node_modules/mdast-util-to-hast  license
yes node_modules/mdast-util-to-markdown  license
yes node_modules/mdast-util-to-string  license
yes node_modules/micromark  license
yes node_modules/micromark-core-commonmark  license
yes node_modules/micromark-factory-destination  license
yes node_modules/micromark-factory-label  license
yes node_modules/micromark-factory-space  license
yes node_modules/micromark-factory-title  license
yes node_modules/micromark-factory-whitespace  license
yes node_modules/micromark-util-character  license
yes node_modules/micromark-util-chunked  license
yes node_modules/micromark-util-classify-character  license
yes node_modules/micromark-util-combine-extensions  license
yes node_modules/micromark-util-decode-numeric-character-reference  license
yes node_modules/micromark-util-decode-string  license
yes node_modules/micromark-util-edit-map  license
yes node_modules/micromark-util-encode  license
yes node_modules/micromark-util-html-tag-name  license
yes node_modules/micromark-util-normalize-identifier  license
yes node_modules/micromark-util-resolve-all  license
yes node_modules/micromark-util-sanitize-uri  license
yes node_modules/micromark-util-subtokenize  license
yes node_modules/micromark-util-symbol  license
yes node_modules/micromark-util-types  license
yes node_modules/mimic-response  license
yes node_modules/minimist  LICENSE
yes node_modules/mkdirp-classic  LICENSE
yes node_modules/motion  LICENSE.md
yes node_modules/motion-dom  LICENSE.md
yes node_modules/motion-utils  LICENSE.md
yes node_modules/ms  license.md
yes node_modules/napi-build-utils  LICENSE
yes node_modules/node-abi  LICENSE
yes node_modules/nth-check  LICENSE
yes node_modules/once  LICENSE
yes node_modules/orderedmap  LICENSE
yes node_modules/parse-entities  license
yes node_modules/parse-entities/node_modules/@types/unist  LICENSE
yes node_modules/parse5  LICENSE
yes node_modules/parse5-htmlparser2-tree-adapter  LICENSE
yes node_modules/parse5-parser-stream  LICENSE
yes node_modules/prebuild-install  LICENSE
yes node_modules/property-information  license
yes node_modules/prosemirror-changeset  LICENSE
yes node_modules/prosemirror-commands  LICENSE
yes node_modules/prosemirror-dropcursor  LICENSE
yes node_modules/prosemirror-gapcursor  LICENSE
yes node_modules/prosemirror-history  LICENSE
yes node_modules/prosemirror-inputrules  LICENSE
yes node_modules/prosemirror-keymap  LICENSE
yes node_modules/prosemirror-model  LICENSE
yes node_modules/prosemirror-schema-list  LICENSE
yes node_modules/prosemirror-state  LICENSE
yes node_modules/prosemirror-tables  LICENSE
yes node_modules/prosemirror-transform  LICENSE
yes node_modules/prosemirror-view  LICENSE
yes node_modules/pump  LICENSE
yes node_modules/punycode.js  LICENSE-MIT.txt
yes node_modules/pvtsutils  LICENSE
yes node_modules/pvutils  LICENSE
yes node_modules/radix-ui  LICENSE
yes node_modules/rc  LICENSE.APACHE2 LICENSE.BSD LICENSE.MIT
yes node_modules/react-konva  LICENSE
yes node_modules/react-markdown  license
yes node_modules/react-reconciler  LICENSE
yes node_modules/react-remove-scroll  LICENSE
no  node_modules/react-remove-scroll-bar
yes node_modules/react-resizable-panels  LICENSE.md
yes node_modules/react-style-singleton  LICENSE
yes node_modules/readable-stream  LICENSE
yes node_modules/remark-parse  license
yes node_modules/remark-rehype  license
yes node_modules/rope-sequence  LICENSE
yes node_modules/safe-buffer  LICENSE
yes node_modules/safer-buffer  LICENSE
yes node_modules/sax  LICENSE.md
yes node_modules/scheduler  LICENSE
yes node_modules/semver  LICENSE
yes node_modules/seroval  LICENSE
yes node_modules/seroval-plugins  LICENSE
yes node_modules/sharp  LICENSE
yes node_modules/simple-concat  LICENSE
yes node_modules/simple-get  LICENSE
yes node_modules/sonner  LICENSE.md
yes node_modules/space-separated-tokens  license
yes node_modules/string_decoder  LICENSE
yes node_modules/stringify-entities  license
yes node_modules/strip-json-comments  license
yes node_modules/style-to-js  LICENSE
yes node_modules/style-to-object  LICENSE
yes node_modules/tailwind-merge  LICENSE.md
yes node_modules/tar-fs  LICENSE
yes node_modules/tar-stream  LICENSE
yes node_modules/tiny-typed-emitter  LICENSE
yes node_modules/tldts  LICENSE
yes node_modules/tldts-core  LICENSE
yes node_modules/tldts-experimental  LICENSE
yes node_modules/trim-lines  license
yes node_modules/trough  license
yes node_modules/tslib  LICENSE.txt
yes node_modules/tunnel-agent  LICENSE
yes node_modules/undici  LICENSE
yes node_modules/unified  license
yes node_modules/unist-util-is  license
yes node_modules/unist-util-position  license
yes node_modules/unist-util-stringify-position  license
yes node_modules/unist-util-visit  license
yes node_modules/unist-util-visit-parents  license
yes node_modules/universalify  LICENSE
yes node_modules/use-callback-ref  LICENSE
yes node_modules/use-image  LICENSE
yes node_modules/use-sidecar  LICENSE
yes node_modules/use-sync-external-store  LICENSE
yes node_modules/util-deprecate  LICENSE
yes node_modules/uuid  LICENSE.md
yes node_modules/vfile  license
yes node_modules/vfile-message  license
yes node_modules/w3c-keyname  LICENSE
yes node_modules/whatwg-encoding  LICENSE.txt
yes node_modules/whatwg-mimetype  LICENSE.txt
yes node_modules/wrappy  LICENSE
yes node_modules/zod  LICENSE
yes node_modules/zustand  LICENSE
yes node_modules/zwitch  license
```

### The extension zip

The dates and times depend on when the build ran.

```bash
unzip -l dist/birdbrain-extension.zip
```

```text
Archive:  dist/birdbrain-extension.zip
  Length      Date    Time    Name
---------  ---------- -----   ----
      436  2026-09-27 22:55   theme-preinit.js
    21654  2026-09-27 22:55   content.js
        0  2026-09-27 22:55   assets/
    16029  2026-09-27 22:55   assets/popup.css
    15614  2026-09-27 22:55   assets/options.css
     5658  2026-09-27 22:55   options.js
    19172  2026-09-27 22:55   background.js
        0  2026-09-27 22:55   fonts/
    48256  2026-09-27 22:55   fonts/inter-latin-wght-normal.woff2
      294  2026-09-27 22:55   fonts/fonts.css
        0  2026-09-27 22:55   chunks/
   223422  2026-09-27 22:55   chunks/theme.js
     4362  2026-09-27 22:55   chunks/api.js
        0  2026-09-27 22:55   icons/
      828  2026-09-27 22:55   icons/icon-16.png
    21247  2026-09-27 22:55   icons/icon-128.png
     4664  2026-09-27 22:55   icons/icon-48.png
     1200  2026-09-27 22:55   manifest.json
      663  2026-09-27 22:55   popup.html
      684  2026-09-27 22:55   options.html
    15506  2026-09-27 22:55   popup.js
---------                     -------
   399689                     21 files
```

### What the allowlist lets in

Nothing in the package lies outside `build.files`. Inside it, these are worth a look:

- **`better-sqlite3` sources and build output:** the unpacked tree holds its C++ sources, the
  SQLite amalgamation twice (`deps/sqlite3/sqlite3.c` and
  `build/Release/obj/gen/sqlite3/sqlite3.c`, identical, 9,507,980 bytes each), a `Makefile`, and
  `test_extension.node`.
- **arm64 binaries in an x86-64 package:** `@img/sharp-linux-arm64` and
  `@img/sharp-libvips-linux-arm64` ship beside their x86-64 twins. `pnpm-workspace.yaml` lists
  `arm64` beside `x64` under `supportedArchitectures`, so the install holds both.
- **`resources/icon_nobg.png`:** it ships inside the archive. The app loads `resources/icon.png`
  (`src/main/index.ts:219`); the only reference to `icon_nobg.png` is in `README.md`.
- **Renderer fonts:** the 13 font files in `out/renderer/assets/` are hashed copies of the
  `@fontsource-variable` files. No file under `out/` carries their licence text; the archive
  carries it in `node_modules/@fontsource-variable/inter/LICENSE` and
  `node_modules/@fontsource-variable/jetbrains-mono/LICENSE`.
- **Six package folders with no licence file:** `@hono/zod-validator`,
  `@img/sharp-libvips-linux-arm64`, `@img/sharp-libvips-linux-x64`, `boolbase`, `lazy-val`, and
  `react-remove-scroll-bar`. The maintainer's ruling on #1364 calls for a committed overrides file
  to supply text for such packages.
- **The extension zip:** `fonts/` holds the Inter font and `fonts.css` and no licence.
  `extension/vite.config.ts` copies the whole `extension/src/fonts/` folder into the build, so the
  `OFL.txt` that PR #1620 would add there would reach the zip once it merges.
- **`demo-case.birdbrain`:** it ships once, outside the archive, through `extraResources`. The
  archive's `resources/` holds the other nine tracked files under `resources/`.

## Font licence files and check

The change that adds this file adds an `OFL.txt` beside each committed font folder except the
extension's:

| Folder | Families | Content |
| --- | --- | --- |
| `.design-sync/fonts/inter/files/` | Inter | `node_modules/@fontsource-variable/inter/LICENSE`, unchanged |
| `.design-sync/fonts/jetbrains-mono/files/` | JetBrains Mono | `node_modules/@fontsource-variable/jetbrains-mono/LICENSE`, unchanged |
| `docs/design-handoff/2026-09-14-design-project-export/_ds/birdbrain-ui-9632b0b0-024d-4a3c-94db-688afdd4768f/fonts/` | Both | The first line of each package's `LICENSE`, its copyright line, then the OFL-1.1 text, which is the same in both files |
| `docs/design-handoff/2026-09-19-shared-case-members/_ds/birdbrain-ui-9632b0b0-024d-4a3c-94db-688afdd4768f/fonts/` | Both | The same file as the previous row |

`tests/fontLicenceCheck.test.ts` pins each file against the installed packages.

`scripts/font-licence-check.mjs` reads `git ls-files` and fails when a folder holding `.woff`,
`.woff2`, `.ttf`, or `.otf` files has no licence file beside them: a file named `OFL`, `LICENSE`,
`LICENCE`, or `COPYING`, in any case, with an optional version suffix and an optional `.txt` or
`.md` extension. The Security workflow runs it as the **Font licence check** job on every pull
request and every push to `main`. It runs there because, on a pull request that changes only files
under `docs/`, `ci.yml`'s `changes` job classes the change as non-code and lint, typecheck, test,
build, and e2e are skipped; two of the five font folders are under `docs/`. The check's test runs the
script against a throwaway repository: it passes with the licence tracked, fails once the licence
is removed, and passes again when it is restored.

The check does not look inside pages that pack fonts, and it checks a licence file's name, not its
text.

## Needs the maintainer

Unresolved. Replacing or removing material is #265's criterion 5, which is the maintainer's.

1. **The Reuters Institute article capture.** `captured-page-slim.jpg` and
   `pasted-1786076566546-0-msifvf7w-wjzq.png`, 11 renders that show it, and the three packed
   pages. The mock uses it as its sample capture. The article text, the page design, and the
   Reuters photograph belong to third parties, and no licence is on record.
2. **The Birdbrain logo.** 22 files in the binary files table. The logo also appears in most mock
   renders and app screenshots, in the three packed pages, in the Linux package (`resources/icon.png`,
   `resources/icon_nobg.png`, `resources/icons/`, `out/renderer/assets/logo-*.png`, and the icons
   the `.deb` installs under `/usr/share/icons/hicolor/`) and in the extension zip. The commits
   that added it, and the documents this walk searched, record neither who created it nor on what
   terms.
3. **Screenshots of third-party products.** `pasted-1785980228073-0.png` shows Autopsy 3.0.0b3 and
   `pasted-1786142913073-0.png` shows Hunchly 2.0.
4. **Copied code without its notice.** `skeleton.tsx` and `tabs.tsx` (MIT, shadcn/ui); the three
   auto-archiver fixtures (MIT, Bellingcat; the fixture README names the licence, and the
   repository does not carry its text); the React 18.3.1 bundles in the three packed pages (MIT,
   header only); and `_ds_bundle.js` (`motion`, `class-variance-authority` under Apache-2.0,
   `clsx`, `tailwind-merge`, and Radix, with no licence text). The Tailwind CSS style sheets keep
   Tailwind's one-line header in each copy.
5. **Fonts packed in the three standalone pages.** Four OFL-1.1 fonts in each, and no licence text
   in any of them. The font licence check looks at font files, not at fonts packed into a page.
6. **The design tool's runtime.** `support.js`, eight copies, and its packed copies in the three
   pages. It says it was generated from `dc-runtime/src/*.ts` and states no copyright or terms.
7. **DigiCert's timestamp response and token.** The fixture README records their origin, a request
   to DigiCert's public timestamp service; no terms are on record.
8. **`extension/src/fonts/`.** PR #1620 would add its licence file; merging it clears this row and
   the font licence check's report.
9. **`pasted-1786496337564-0.png`.** An arrow drawing with no recorded origin.
10. **`pasted-1786096220328-0.png`.** A capture of the mock that includes a Windows Snipping Tool
    notification.

Items 1, 2, 3, 4 (the three fixtures), 7, 8, 9, and 10 hold the 45 binary files that need the
maintainer: 13, 22, 2, 3, 2, 1, 1, and 1.

## Noticed outside this walk

- `tests/main/services/extraction/fixtures/cnn-iran-synthetic.mhtml` and
  `cnn-pope-synthetic.mhtml` name CNN and use `cnn.com` addresses around synthetic article text.
  They are text files, so the binary files table does not cover them.
