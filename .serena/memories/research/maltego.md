# Maltego — competitor/reference research (link analysis)

Two primary-source notes; read them before designing or brainstorming the Link Map (#382) or any
investigation-graph / integration / automation surface. Do not re-derive from training priors —
Maltego renamed plans, Transforms, and clients in 2025 and most third-party write-ups are stale.

- `docs/specs/2026-08-12-maltego-graph-node-research.md` — graph/Entity/link data model, merge rules,
  Transform contract, Desktop vs Browser parity, plan boundaries. (Only in a t3 checkpoint ref as of
  2026-08-18, not on `main`; extracted copy was at `/tmp/maltego-prior.md`.)
- `docs/specs/2026-08-18-maltego-features-and-workflows-research.md` — 162 first-party sources.
  Part 1 = 14-section feature inventory (ribbon tabs, layouts/viewlets, windows, entities, Data Hub,
  collections, Machines, import/export, Browser specifics, Cases/collab, adjacent products, dev
  surface, limits). Part 2 = 13 step-by-step workflows (L1–L3 domain footprint, attack surface +
  custom Machine, POI, email/phone/alias pivot, IOC enrichment, corporate structure, crypto
  Address→Transaction→Address, historical web/metadata, tabular import, own-data Transforms,
  monitoring, hand-off, reporting hygiene). Part 3 = drift list + unsourced gaps.

## Durable takeaways
- Maltego is a graph *system*: typed Entities + property-bearing directed links + Transforms
  (expand) + Machines (automate) + Data Hub (packaged integrations). Birdbrain's Link Map is a
  read-only Case-scoped projection over Notes/Captures/Selectors/Tags — do not conflate.
- Every documented workflow has one shape: typed seed Entity → pivot chain (often a Machine) →
  user-filter pruning → bookmarks / select-by / collections to tame size → PDF/table export or Cases
  hand-off. Useful as a mental model for what "investigation graph" features actually get used.
- Graph size taming is a first-class feature set (viewlets, collections, filters, bookmarks, entity
  slider stops 12/56/4k/65k) — relevant precedent for the Link Map 20-node ceiling debate.
- Maltego Graph documents no per-Entity provenance, hash chain, signed manifest, or trusted time.
  Evidence semantics stay Birdbrain's differentiator; Maltego Evidence/Hunchly are separate products.
- Storage model (2026): Browser saves to E2E-encrypted cloud Cases (AES-256-GCM / RSA-OAEP-4096 /
  PBKDF2 600k; Maltego sees only Entity IDs+types+links) or a linked local folder as `.mtgj`.
  Desktop file formats: `.mtgx`/`.mtgl` graphs, `.mtz` config bundles (entities/transforms/machines).
- Machines: Desktop-only for custom servers; Browser release notes mention a "Machine Operator" —
  unresolved. Search Transforms re-platformed Aug 2025 (Bing removed → Brave/Google CSE); Standard
  Transforms/CTAS carry legacy banners. Treat any Transform name from pre-2025 material as historical.

## Volatile / recheck before relying
Plan names & limits, CE per-graph Entity ceiling (10,000 figure no longer on CE page), per-Transform
credit costs, Data Pass provider list, Browser Workflow Guides (all Maltego-ID login-gated),
whether Desktop 4.12.x kept set-level `>>` run-all after 4.12.1 removed "Run All".
