# Theming charter

**Persona:** A researcher who switches display modes to work comfortably across long sessions.

## Goal

Switch themes repeatedly while navigating the dashboard, every case tab, overlays, dialogs, and
settings. Exercise different window sizes when useful. Look for unreadable contrast, unthemed
native controls, stale colors, flashes, clipping, lost theme state, and visual inconsistency.

## Reporting

For every finding, record a title, severity guess, repro steps exactly as performed, expected
versus observed behavior, and the screenshot path. Also write a session report covering what
was explored and what worked fine. Do not file issues during the run.

## How to drive

Use `scripts/exploratory-harness.mjs`. Loop through: `snapshot` →
`click`/`type`/`typetext`/`press` → `screenshot` → read the PNG and judge it visually → drain
`console` → continue.

Isolation is mandatory: use only the harness-created temp profile. Never point the harness at a
real userData directory.
