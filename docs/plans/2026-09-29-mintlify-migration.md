# Move the docs site from Fumadocs to Mintlify

**Status:** Draft, awaiting maintainer decisions

**Depends on:** the docs site trim (branch `docs/site-trim`), which cuts the site from 12 pages
to 7. Start this work after that merges.

## Current state

- The published site is Fumadocs on Next.js, statically exported and deployed to GitHub Pages at
  <https://thebristolsound.github.io/birdbrain/> by `.github/workflows/docs.yml`
  (`docs/agents/website.md`).
- Mintlify deployment `birdbrain` renders the same MDX as an unpublished evaluation mirror, from
  `website/content/docs.json`. It is not wired into CI.
- The mirror has two known conflicts with Fumadocs (`docs/agents/website.md`, "Mintlify
  mirror"):
  - Internal links. Fumadocs needs `./name.mdx`. Mintlify needs root-relative paths without an
    extension, and its docs say relative paths and paths with extensions do not work in
    production ([Format text](https://mintlify.com/docs/create/text)). After the trim, 14 internal links
    use the Fumadocs form.
  - Images. Mintlify resolves image paths from the root of the docs repository, and relative
    paths are not supported ([Images and embeds](https://mintlify.com/docs/create/image-embeds)).
    Birdbrain's 17 `/assets/` references resolve through Next's `public/` folder, which sits
    outside the Mintlify content directory.
- Places that hard-code the Pages URL: `README.md` (8), `.github/workflows/release.yml` (2),
  `.github/workflows/docs.yml`, and `website/lib/base-path.mjs`. The releases repository README
  and the source repository's homepage field are outside this tree.
- Unverified: the deployment's deploy branch and content directory. The Mintlify administration API
  returned "No target deployment" on 2026-09-29, so check them in the dashboard.

## Decisions

1. **Address: `birdbrain.cc`** (decided 2026-09-29). The maintainer owns it at Porkbun and it
   points nowhere today. Mintlify serves custom domains with automatic TLS after DNS
   verification ([Custom domain](https://mintlify.com/docs/customize/custom-domain)).
   - The docs live at `docs.birdbrain.cc`, and the bare `birdbrain.cc` forwards there
     (decided 2026-09-29). That keeps the bare domain free for a landing page later. A
     subdomain needs only a plain `CNAME`; Porkbun URL forwarding covers the bare domain.

2. **Plan: Mintlify Starter, free** (decided 2026-09-29). Mintlify's pricing page lists a custom
   domain, the web editor, and five editor seats on Starter
   ([Pricing](https://www.mintlify.com/pricing)). After the repository is public, apply to the
   [OSS Program](https://www.mintlify.com/oss-program), which gives Pro free to projects with a
   recognized open source license that are not venture-backed, revenue-funded, or owned by a
   for-profit company. Pro would add preview deployments for docs pull requests.
3. **Analytics** (open). Mintlify-hosted pages may carry the vendor's analytics. Birdbrain tells
   privacy-minded investigators it has no telemetry, so check what Starter collects and whether
   it can be turned off before switching.

## Steps

1. **Make Mintlify the only renderer.**
   - Rewrite the 14 internal links to `/docs/<page>` form.
   - Move `website/public/assets/` under the content directory and point the 17 image
     references at the new root-relative path.
   - Run `mint broken-links` locally, and `mint dev` to check every page renders.
2. **Retire Fumadocs.**
   - Delete the Next.js app under `website/` (`app/`, `lib/`, `next.config.mjs`,
     `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`), keeping only the content and
     `docs.json`.
   - Delete `.github/workflows/docs.yml`.
   - Update `CLAUDE.md`/`AGENTS.md` ("Docs site commands"), `docs/agents/website.md`, the
     `website/` entries in `eslint.config.js` and in `build.files` in the root `package.json`,
     and `dependabot.yml` if it watches `website/`.
3. **Add a link check to CI.** A workflow step that runs `mint broken-links` on pull requests
   touching `website/`. Running it through `npx` in CI keeps it out of the root dependencies.
4. **Configure the deployment** in the Mintlify dashboard: deploy branch `main`, content
   directory `website/content` (or wherever step 1 lands the content), and GitHub access to the
   repository.
   Then add the domain in the dashboard, which shows two verification `TXT` records and a
   `CNAME` for `docs.birdbrain.cc` pointing at `cname.mintlify.builders`. Add the `TXT` records
   first, and the `CNAME` only after both show as verified. Then forward `birdbrain.cc` to
   `https://docs.birdbrain.cc`.
   - Porkbun's official MCP server (`@porkbunllc/mcp-server`, <https://porkbun.com/mcp>) can
     create these records. It needs an API key pair from <https://porkbun.com/account/api>, and
     the domain must be opted in to API access.
5. **Cut over.**
   - Point every hard-coded URL at the new address.
   - Replace the Pages site with a one-page notice that redirects to the new address. GitHub
     Pages serves static files only, so this is a meta refresh plus a visible link, not a
     server redirect. Keep it up for at least one release cycle.
   - Update the releases repository README and the homepage field on both repositories.
6. **Record the decision** in an ADR, since this replaces the publishing platform that
   `docs/agents/website.md` documents.

## Verification

- `mint broken-links` reports zero broken links.
- Every page in the navigation renders on the Mintlify preview, including the screenshot tour.
- The old Pages address sends a visitor to the new one.
- `git grep thebristolsound.github.io/birdbrain` returns only the notice page.
