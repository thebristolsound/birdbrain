# Persona is a provenance axis beside Operator, not a facet of it

**Status:** Accepted

**Date:** 2026-09-19

Resolves #542 and #544 under map #541. Grilled and confirmed by the maintainer on 2026-09-19;
the working plan is `docs/plans/2026-09-19-persona-cookie-import.md`.

## Context

Two audiences need captures of signed-in pages. Most users want their own logged-in view of a
site. The round-1 group (#284) works under pseudonyms and needs the app never to confuse, leak,
or mis-attest which identity was active. The Manifest attests who was present, so whatever a
persona is decides what every Manifest Entry says. Three shapes were on the table: a facet of
Operator (the Operator record gains an "acting as" field and `operatorName` carries the
persona), a per-Case declaration (each Case lists the personas it may use), or a per-install
registry stamped on each Exhibit.

## Decision

**A Persona is a per-install registry entry and a per-Exhibit provenance attribute, orthogonal
to Operator.** The Operator stays the human and is recorded on every entry as today. A Persona
adds `personaId` and `personaLabel` beside it; it never replaces `operatorName`. Registration
is installation-wide, like a Tag. Per-Case binding is deferred to the export-disclosure
decision (#543).

**The label is frozen at acquisition.** The row and the Manifest Entry keep the label the
Persona had when the Exhibit was acquired. A rename never rewrites either.

**Deletion is soft.** Deleting a Persona clears its browser session's storage and hides it from
pickers; the row stays so historic Exhibits keep their label. Clearing the cookies is the
security action and is always available.

**Two mechanisms, one attribute.** A background Recapture or add-URL render may run through a
persistent Electron session seeded for the Persona by cookie-file import or by a sign-in window
the user completes by hand. An extension Capture can only declare the Persona the operator
says the tab was signed in as. The Manifest wording differs: "persona session used" for the
first, "persona declared by operator" for the second.

**No secrets beyond the browser session.** Cookie files are read, loaded into the session, and
discarded; their bytes are never copied under the install. Passwords are never stored. The
only copy of a cookie value is Chromium's own store for that session, protected by the OS key
that `safeStorage` reports on, with the #414 warning when that key is absent.

**Optional Manifest fields, no schema bump.** `personaId` and `personaLabel` are optional on
`capture` entries and on `exhibit` entries whose origin is `extension`, `background` or
`extension-image`. `derivation` entries carry nothing: a derivation is computed offline and
inherits from its parent. Existing chain hashes are unchanged. The verifier is strict, so the
release that teaches it the fields ships before any build writes them (the ADR-0023
sequencing).

**The term is Persona everywhere**, domain model and UI, framed as a signed-in browser
identity, yours or a pseudonym.

## Considered options

- **Facet of Operator.** Rejected: `operatorName` would stop naming the human, and every
  Exhibit from a pseudonymous session would mis-attest who was present, the exact failure the
  map exists to prevent.
- **Per-Case declaration.** Real value for a security-strict team, but it forces the registry
  to be per Case and duplicates every Persona across Cases. It can be layered on the per-install
  model later; starting with it cannot be undone as cheaply.
- **Schema bump to 4.** Buys only a clearer error for stale verifiers; the strict-parse hazard
  and the ship-verifier-first sequencing are identical either way.

## Consequences

- The `capture` and `exhibit` entry schemas, the capture row, `captureLifecycle.ingest`, the
  shared verifier and the standalone verifier all change; each is evidence-affecting.
- Extension captures carry a claim the app cannot check. Export and report wording (#543) must
  keep the two grades distinct.
- The threat-model delta (#546) owes the guarantees: cross-persona linkage on disk, cookie
  theft at rest, wrong-persona capture, and what is not promised (OS-level isolation, network
  attribution, bot detection).
- Whether an Electron session survives bot detection on the target platforms is open (#545)
  and gates the session-backed mechanism only; the declared-label mechanism and the registry
  do not wait on it.
