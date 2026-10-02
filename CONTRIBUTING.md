# Contributing to Birdbrain

Thanks for your interest in Birdbrain. This guide sets realistic expectations for a
solo-maintained project: contributions are welcome, and the process is deliberately
lightweight — no CLA, no sign-offs, no committees.

Please also read the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security
vulnerability, do **not** open a public issue — see [SECURITY.md](SECURITY.md).

## Maintainer capacity

Birdbrain has one maintainer. Issues and pull requests are handled on a best-effort
basis, usually within a week, sometimes longer. There is no response-time guarantee
and no support contract. A quiet issue is a busy maintainer, not a rejection.

## Supported scope

Birdbrain is beta software: an Electron desktop app, a companion Chromium extension,
a standalone verifier CLI, and a docs site. Contributions most likely to land:

- Bug fixes, especially with a reproduction
- Documentation and docs-site improvements
- Test coverage for existing behavior
- Features already discussed and agreed in an issue

Contributions unlikely to land:

- Features that conflict with the project's posture: local-first, no accounts, no
  telemetry, no cloud dependency
- Large refactors or new dependencies without a prior issue
- Evidence-affecting changes that arrive without discussion — see
  "Evidence-affecting changes" below for what that covers

## Issues first

- **Bug reports and feature requests** — use the issue forms; they collect the
  details triage needs.
- **Non-trivial pull requests** — open an issue first and agree the approach before
  writing code. This protects your time: an unagreed PR may be declined even when
  the code is good.
- **Trivial fixes** (typos, broken links, obvious one-line bugs) — a direct PR is
  fine.

## Development setup

1. Use **Node 20** (`.nvmrc` and `.mise.toml` pin it) and [pnpm](https://pnpm.io/).
2. `pnpm install` — installs dependencies and rebuilds the native SQLite module.
3. `pnpm dev` — starts the Electron app in dev mode.
4. `pnpm build:extension` — builds the Chrome extension (load `extension/dist`
   unpacked via `chrome://extensions`).

The docs site is `website/content/`, published by Mintlify at <https://docs.birdbrain.cc>.
Preview it with `pnpm dlx mint dev` and check links with `pnpm dlx mint broken-links`, both run
from inside `website/content/`.

## Validating your change

Before opening a PR, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm build:extension   # if you touched extension/
```

E2E tests (`pnpm test:e2e`) are optional locally; CI runs the full suite. Formatting
is enforced by Prettier/ESLint — `pnpm format` fixes style rather than debating it.

## Evidence-affecting changes

Birdbrain's value rests on its forensic guarantees. The canonical definition lives in
[`CONTEXT.md`](CONTEXT.md) under "Assurance baseline" and is quoted verbatim here — if
that sentence changes, this copy and the one in the PR template change with it:

> An evidence-affecting change includes acquisition, parsing, extraction, storage,
> hashing, signing, trusted time, manifests, verification, redaction, export,
> reporting, AI analysis, and software distribution when it can alter an evidentiary
> result or its interpretation.

These changes get closer review, must state their evidence impact in the PR, and are
never merged without human review. Changes that are not evidence-affecting may merge on green
once reviewed ([`docs/adr/0014-tier-the-evidence-backstop-and-widen-the-dispatch-slot.md`](docs/adr/0014-tier-the-evidence-backstop-and-widen-the-dispatch-slot.md)).
The PR template walks you through this; the path
inventory lives in
[`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`](docs/specs/2026-07-31-evidence-affecting-paths-assessment.md)
and the review gates in
[`docs/adr/0005-unattended-agents-on-the-evidence-path.md`](docs/adr/0005-unattended-agents-on-the-evidence-path.md).

Run the suite in its strict form when your change touches one of these paths:

```bash
BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test
```

Plain `pnpm test` is not enough here: without that variable the RFC 3161 trusted-time
tests skip themselves on a machine with no `openssl` CLI, so the suite goes green with
the keystone verification proof never having run.

Expect slower, stricter review on these paths — that is by design.

## Inbound licensing

Birdbrain is licensed under the [MIT License](LICENSE), and contributions follow the
GitHub-default inbound = outbound model: by submitting a contribution, you agree it
is licensed under the same MIT terms as the project. There is no CLA and no DCO
sign-off. Submit only work you have the right to contribute — your own, or code
whose license permits inclusion under MIT (say so in the PR if it is the latter).
