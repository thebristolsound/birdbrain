# Design system producer

Rebuilds the Birdbrain design system, the Design System artifact at
<https://claude.ai/artifact/PuSPirFB3S21HN5daWk8CG>, from the code in this repository. The
artifact is a brand book, token tables, fonts, logos and component previews that other agents
and people read before they build on the brand; this folder is what keeps it true to `main`.

## Run it

```sh
pnpm design-system          # writes design-system/dist/project/ and reports
pnpm design-system --check  # the same, exits 1 on any finding (CI runs this)
```

Node 20, no dependencies. The output folder is ignored by git.

## What it reads

| Source                                                                                                                         | Becomes                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/styles/globals.css`: every custom property under `@theme`, `:root`, `html.dark` and the two `data-density` steps | `tokens.json` colour (light and dark), shadow, spacing, radius and tracking families, plus the font stacks                                     |
| `notes.json`                                                                                                                   | the usage note on every token; the comment above a declaration is the fallback, and a token with neither is reported                           |
| `type-styles.json`                                                                                                             | the text styles, hand-maintained from the Tailwind sizes the renderer uses and the classes in `globals.css`                                    |
| `sources.json`                                                                                                                 | the font files to copy, the logo files and their uploaded asset records, the component source map, the family notes and the artifact's address |
| `content/`                                                                                                                     | the brand book (`README.md`), the asset group notes, and one `README.md` and `preview.html` per component, copied verbatim                     |

Classification is by name: `color-*` is a colour (a `var(--other)` value becomes the alias
`{other}`), `shadow-*` a shadow, `radius*` and `d-r` radii, `d-*` spacing with the compact and
comfortable values appended to the note, `tracking-*` tracking, `font-*` a font stack. A value
that uses `calc()` or `color-mix()`, or a name that fits no family, is reported and skipped.

## What `--check` catches

- a token with no usage note in `notes.json`
- a custom property the classifier cannot place, or a value the token format cannot hold
- an alias of a colour that does not exist
- a preview or README that uses a `var(--x)` no token declares
- a component in `sources.json` with no `README.md` or `preview.html` under `content/`
- a logo whose bytes changed since it was uploaded (its `size` no longer matches)

The workflow in `.github/workflows/design-system.yml` runs it on every pull request that
touches the stylesheet, the `ui/` primitives or this folder, and uploads the output as a
workflow artifact.

## Publish

Publishing is a separate step, because the artifact is written through Claude's Artifact
tooling rather than an API this repository can call. In a Claude session with this repository
checked out:

> Rebuild the design system with `pnpm design-system`, then publish every file under
> `design-system/dist/project/` to the artifact named in `design-system/sources.json`, as a
> re-sync: keep usage notes and prose people edited on the page, update changed values, add
> what is new, and list tokens the code no longer defines before removing them.

The session reads the artifact's current files first, so edits made on the page are merged,
not overwritten; `lastChange` in the index records who published and from which commit.

## Change something

- **A token changed in `globals.css`**: run the build; nothing else to do unless the token is
  new, in which case add its note to `notes.json`.
- **A new `ui/` primitive**: add it to `components` in `sources.json`, write
  `content/components/<Name>/README.md` (first sentence is the summary; say when to use it,
  what the consumer provides, and the rules) and `content/components/<Name>/preview.html` (line 1
  is `<!-- @dsCard group="…" height=N -->`, then a small static document styled only with
  `var(--token)` values and the classes already in the file), and add an entry to
  `content/components/index.d.ts`.
- **A logo changed**: upload the new file to the artifact's asset store, then update `blob`
  and `size` in `sources.json`; the check fails until you do.
- **A new font file**: add it to `fonts` in `sources.json` with its `@font-face` weight range.
- **Prose**: edit `content/README.md`; the page shows it as the brand book.

The previews are static renditions hand-written from each primitive's classes, not the built
components. If a primitive's classes change, update its preview by hand; the check cannot see
that drift.
