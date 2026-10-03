# Passive capture returns in the launched browser, not a declared window

**Status:** Accepted

**Date:** 2026-10-02

Amends [ADR-0013](0013-passive-capture-scoped-to-a-declared-window.md) (the Capture Scope and the
Capture Method split) and adds `launched-passive` to the Capture Methods of
[ADR-0034](0034-the-app-acquires-and-the-extension-is-a-companion.md). Confirmed by the
maintainer on 2026-10-02. Nothing in this record is implemented.

## Context

ADR-0013 brings passive capture back under an opt-in scope: one browser window the Operator
designates. The extension enforces that scope, because only the extension knows a `windowId`, so
the Manifest can record the scope only as the Operator's declaration, never as a verified
boundary. [#600](https://github.com/thebristolsound/birdbrain/issues/600) carries the restoration
and is blocked by [#598](https://github.com/thebristolsound/birdbrain/issues/598) (extraction
blocks the main process) and [#597](https://github.com/thebristolsound/birdbrain/issues/597) (the
ignore default excludes no `https` origin).

[ADR-0034](0034-the-app-acquires-and-the-extension-is-a-companion.md) moves acquisition into the
app's capture engine and adds a browser Birdbrain launches, with a profile of its own per
Persona. The engine drives that whole browser and records every Capture taken there.

## Decision

**The Capture Scope is the launched browser.** Passive capture runs only during a Capture Session
in a browser Birdbrain launched. The engine owns every window and tab of that browser, so the
boundary is one the engine enforces and can state as fact, not an Operator declaration. The
Operator's everyday browser never captures without a click.

**Both passive paths return there.** A running session can capture every page that loads, or only
the pages an Active Case Selector matches. Each passive Capture carries a Transaction Record,
because recording is already on in that session. The Case's exclusion policy applies to passive
Captures as it does to clicked ones.

**The Capture Method split follows ADR-0034's values.** A Capture the Operator clicked in the
launched browser is `launched`; a Capture the session took without a click is `launched-passive`.
ADR-0013's `extension-manual` and `extension-passive` are not introduced, and `extension` stays a
legacy value on Captures already written.

## What this amends

ADR-0013 stands on why passive capture needs a scope, on rejecting a tab and a domain allowlist,
and on the main-process freeze fix being a prerequisite. Its designated window becomes the
launched browser, its attested-declaration wording no longer applies to Captures taken there, and
its `extension-manual` and `extension-passive` become `launched` and `launched-passive`.
`background` stays as ADR-0013 and ADR-0034 have it.

## Considered options

- **Keep the designated window in the everyday browser.** Rejected: the boundary stays a
  declaration, the Operator's bank or webmail can enter a Case when they browse in the wrong
  window, and passive Captures there carry no Transaction Record.
- **Passive capture in both browsers.** Rejected for the same reasons, and it would keep the
  extension on the evidence path that ADR-0034 removes.

## Consequences

- Passive capture waits for the launched browser, which ADR-0034 orders after the first engine
  slice. It does not change that slice.
- [#598](https://github.com/thebristolsound/birdbrain/issues/598) stays a prerequisite: passive
  capture pays the extraction cost once per page browsed.
- [#597](https://github.com/thebristolsound/birdbrain/issues/597) stops being a blocker. The
  launched browser holds only investigation browsing, so the ignore default no longer guards the
  Operator's private sites. It still stands on its own merits for clicked Captures.
- [#599](https://github.com/thebristolsound/birdbrain/issues/599) changes shape: no migration of
  existing rows, one new value, and every reporting surface must keep `launched-passive` from
  reading as operator-witnessed.
- The `HOTFIX:` auto-capture blocks in the extension are removed with the extension's acquisition
  role rather than restored.
- How the engine matches Selectors against a page in the launched browser is left to that slice's
  design.
