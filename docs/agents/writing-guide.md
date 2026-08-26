# Writing guide

How to write documentation for Birdbrain — audience, claim discipline, tone, and the shape each kind of document takes.

This guide covers prose. For **where** a document goes and what it is named, see [`docs/README.md`](../README.md). For **what things are called**, see [`CONTEXT.md`](../../CONTEXT.md).

CodeRabbit reads this file as review criteria for `docs/**`, `website/content/docs/**`, and root Markdown.

## Audience

Investigators, activists, and researchers. Assume:

- **Real stakes.** Some readers are documenting things that powerful people would rather were not documented. A wrong claim about what Birdbrain protects is not a cosmetic error.
- **Time pressure.** They are reading to get something done, not to admire the architecture. Lead with the answer.
- **Mixed technical depth.** A researcher who has never opened a terminal and a developer packaging a Linux build read the same site. Name the audience at the top of a page rather than writing for an average of the two.
- **No obligation to trust us.** Birdbrain is beta software from a solo maintainer. Readers are right to check.

Write in the register [`README.md`](../../README.md) already uses: plain, specific, limitation-forward. It says the tool has not been tested in court and tells people not to rely on it as their only copy. Match that.

## Claim discipline

This is the part that matters most, and it comes from the assurance baseline in [`CONTEXT.md`](../../CONTEXT.md) and [ADR-0004](../adr/0004-adopt-osint-assurance-baseline.md).

- **State what a mechanism proves, and what it does not.** A verified hash chain with signed (v2+) entries shows that nobody edited the manifest *without the installation's signing key* — legacy all-v1 manifests predate signing, so their entries verify without one (`src/shared/verify/manifestChain.ts`). It does not constrain the Operator, who holds that key and can mint an internally consistent chain — `SECURITY.md` says so outright. It does not show the page was genuine. And the RFC 3161 token anchors a capture's content hash, not the manifest head, so it dates the content rather than proving the chain around it is intact. Write both halves.
- **No unqualified assurance words.** "Court-admissible", "tamper-proof", "forensically sound", "compliant", "verified" — none of these stand alone. Name the standard and its version, or describe the concrete property instead.
- **Document limitations next to the capability, not in a footnote.** `SECURITY.md` pre-declares unsigned artifacts, the `unsafe-inline` CSP, and the `safeStorage` plaintext fallback. Follow that pattern.
- **Do not describe unshipped behaviour in the present tense.** A spec describes a design; reference docs describe what the code does today. If a page documents something behind a flag or unmerged, say so.
- **Cite the source of a factual claim** — a file path, an ADR, a spec — when the reader would otherwise have to take your word for it.

If you cannot support a claim, cut it. An accurate short page beats a confident long one.

## Vocabulary

[`CONTEXT.md`](../../CONTEXT.md) is authoritative. It defines Case, Capture, Capture Lifecycle, Extracted Text, Selector, Persisted Match, Foreground Match Preview, Manifest, Operator, and Capture Server — each with an explicit `_Avoid_` list of synonyms that drift.

Use the defined term. Do not restate the definitions here; link instead, so there is one copy to keep correct.

If the concept you need is not in the glossary, that is a signal: either you are inventing language the project does not use, or there is a genuine gap worth adding to `CONTEXT.md`.

## Prose

The failure mode to avoid is copy that sounds authoritative and says nothing. Concretely:

- **Cut inflated adjectives.** Powerful, seamless, robust, comprehensive, cutting-edge, enterprise-grade. If the adjective would survive being moved to a different product's page, delete it.
- **Cut empty openers and transitions.** "It's important to note that", "In today's landscape", "Let's dive in", "At the end of the day".
- **Do not restate the heading in the first sentence.** Under "## Exporting a case", start with what exporting does, not "Exporting a case is the process of exporting a case."
- **Do not pad lists to look thorough.** Three real items beat five where two are filler.
- **Prefer the concrete verb.** "Writes a manifest entry attributed to the Operator" over "handles provenance tracking".
- **Say where data goes.** For anything touching capture, storage, export, or AI, name the destination — disk path, loopback port, or external host.
- **Avoid "AI-powered" as a description.** Name the provider, the model, and what gets sent. Birdbrain's analysis calls OpenRouter with an operator-chosen model and sends capture text; say that, not "AI-powered analysis".

## Mechanics

Adopted 2026-08-25 from the corporate rule-catalog tradition — Microsoft, Google, Kubernetes, GitLab — via the [writing-guides brief](../specs/2026-08-25-technical-writing-guides-brief.md) (Guide A there). Vale with the Google package enforces part of this on `*.md`; the rest is review criteria.

- **Voice.** Second person, active voice, present tense. Name the actor; passive only when the actor is unknown, irrelevant, or naming it would read as blame. No "there is" / "there are" openers.
- **Order.** Condition before instruction: "If the build fails, check the log." Prerequisites before step 1, never inside the steps. One action per step; a step may add one sentence of result.
- **Titles.** Sentence case, no end punctuation. Procedure titles start with an imperative, not a gerund — "Create a case", not "Creating a case".
- **Words.** The plain word over the fancy one ("use", not "utilize"; "because", not "since" unless time is meant). "For example" and "that is", not `e.g.` / `i.e.`. No idioms. No "easily" or "simply" — the reader who is stuck feels lied to. Expand an acronym on first use per page.
- **Inclusive terms.** Allowlist/denylist, main/replica, placeholder rather than dummy, and singular "they" for a hypothetical person — or rewrite to drop the pronoun.
- **Formatting.** Serial comma. American spelling. Bold for UI elements; code font for code, commands, filenames, and paths; italics for a new term on first use. Placeholders in angle brackets, defined in the surrounding text. Numbered lists only for sequences.
- **Links and images.** Link text describes the destination — never "click here". Every image has alt text; prefer text to a screenshot when either would do.
- **House style stays.** Em dashes are house style (`README.md`, `SECURITY.md`, and `CLAUDE.md` all use them), along with straight quotes, ASCII apostrophes, and code fences tagged with a language.

## Structure for published pages

Pages under `website/content/docs/` follow [Diataxis](https://diataxis.fr/): decide which of four types a page is before writing it, and do not mix types in one page. Two questions place it — is the reader acting or understanding, and studying or working?

| The reader is | Studying    | Working      |
| ------------- | ----------- | ------------ |
| Acting        | Tutorial    | How-to guide |
| Understanding | Explanation | Reference    |

- **Tutorial** — a lesson; the writer owns the reader's success. Every step visibly works and says what the reader will see. Keep inline explanation minimal and link out for depth. This is the one type where warmth does real work, because a learner who feels stupid stops.
- **How-to guide** — a competent user mid-task. The title names the goal as the user would phrase it. Assume competence, branch where reality branches, and keep the tone brisk and imperative.
- **Reference** — facts, structured to mirror the product, each fact stated once in a predictable place. No steps, no opinions. The mechanics above bind hardest here.
- **Explanation** — context and why. The only type where alternatives, history, trade-offs, and hedged language belong.

When an existing page resists improvement, the usual cause is content sitting in two cells at once. Fix one page at a time — Diataxis itself warns against planning a grand reorganization.

The public mirror of this standard is [`website/content/docs/writing-style.mdx`](../../website/content/docs/writing-style.mdx); keep the two in step when either changes.

## Document types

Placement and naming come from [`docs/README.md`](../README.md). What each type needs:

**Spec** (`docs/specs/YYYY-MM-DD-<slug>-design.md`) — the problem, the constraints, the approach chosen, the alternatives rejected and why, and any open questions. Written at design time and treated as immutable once approved. If the design later changes, write a new spec and move the old one to `docs/archive/`; do not quietly edit history.

**Plan** (`docs/plans/YYYY-MM-DD-<slug>.md`) — an ordered, checkable task list with enough context to resume cold. Living document; staleness is expected and fine.

**ADR** (`docs/adr/NNNN-<slug>.md`) — context, decision, consequences. One decision per record. Consequences include the bad ones. Superseding an ADR means adding a new one that names the old, not rewriting it.

**Reference page** (`website/content/docs/<topic>.mdx`) — public, published, edited in place as the system evolves. Needs `title`/`description` frontmatter and a `meta.json` entry. Open by naming the audience and what the page answers. This is where claim discipline is strictest, because these pages are what an outside reader will quote back.

**Agent doc** (`docs/agents/<topic>.md`) — conventions for how agents and contributors work in this repo. Short, imperative, and concrete about what to do when the rule does not apply.

## MDX constraints

`website/content/docs/` is Fumadocs MDX. Four things break the build or route wrong. The first three come from the "Documentation site" section of [`AGENTS.md`](../../AGENTS.md); the `meta.json` rule is in its "Documentation conventions" section.

1. **Bare `{...}` in prose is a compile error.** MDX parses braces as a JSX expression. Wrap them in backticks.
2. **Internal links need the `./name.mdx` form.** `createRelativeLink` only rewrites hrefs starting with `./` or `../`; a bare slug is emitted as-is and resolves wrong under `trailingSlash: true`.
3. **Image paths are `public/`-relative** (`/assets/x.png`). Fumadocs applies `basePath` for you — never hardcode `/birdbrain/`.
4. **A page absent from `meta.json` is silently dropped from the sidebar.** Adding a page means adding both.

Build the site from inside `website/` (`pnpm build`) before merging a change under `website/` — it has its own lockfile and a root `pnpm install` does not touch it. Files under `docs/` are not part of the site build and need no such check.

## Before merging

- [ ] Every capability claim is true of the code on this branch, not a planned version.
- [ ] Assurance claims say what is proven *and* what is not.
- [ ] Terms match the `CONTEXT.md` glossary, including its `_Avoid_` lists.
- [ ] Nothing contradicts `README.md`, `SECURITY.md`, or an existing ADR — or if it does, that is called out deliberately.
- [ ] File is in the right folder with the right name per [`docs/README.md`](../README.md).
- [ ] New `website/content/docs/` page has frontmatter and a `meta.json` entry, and the site builds.
