# Publish the docs on Mintlify at `docs.birdbrain.cc`

**Status:** Accepted

**Date:** 2026-09-29

The plan behind this record is [the Mintlify migration plan](../plans/2026-09-29-mintlify-migration.md).

## Context

The docs site was a Next.js app built with Fumadocs, statically exported and published to GitHub
Pages at `thebristolsound.github.io/birdbrain`. It carried its own `package.json`, lockfile and
pnpm workspace root, a CI job that installed and built it, and a second tree for the dependency
audit. A Mintlify deployment rendered the same MDX as an unpublished mirror.

One content tree could not serve both sites. Fumadocs needed internal links in `./page.mdx`
form and images under Next's `public/` folder. Mintlify needs root-relative links with no file extension
and images inside its content directory. Each mirror page had dead links and missing screenshots.

## Decision

**Mintlify is the only renderer.** It serves `website/content/` from `main` at
`docs.birdbrain.cc`, on the free Starter plan. `birdbrain.cc` forwards there with a 302, which
keeps the bare domain free for a landing page later. The DNS records are at Porkbun.

**The Fumadocs app is deleted.** `website/` keeps only the content and a one-page notice.
`.github/workflows/docs.yml` publishes that notice to the old Pages address as `index.html` and
`404.html`, so each old page URL redirects to the same page on the new site.

**CI checks links instead of building.** The `docs-build` job keeps its name, so the required
check context does not change, and runs `mint broken-links` at a pinned version through `npx`.
The CLI stays out of the root lockfile.

## Consequences

- The site has no build or dependency tree in this repository. The dependency audit covers one
  tree, and Dependabot has nothing under `website/` to update.
- Deployment settings live in the Mintlify dashboard, outside version control: the connected
  repository, branch, documentation path, custom domain and access control.
- Pull requests do not get a rendered preview on Starter. Mintlify's OSS Program would add
  preview deployments once the repository is public.
- The site's analytics are Mintlify's. Birdbrain tells privacy-minded investigators the app has no
  telemetry, and whether Starter's page analytics can be turned off is still open in the plan.
- The notice on the old Pages address depends on client-side script and a meta refresh, because
  Pages cannot send a server redirect.
