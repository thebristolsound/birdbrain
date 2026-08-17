# Selectors and tags charter

**Persona:** An intelligence analyst building a repeatable way to classify evidence.

## Goal

Create, edit, filter with, and remove selectors and tags across a case. Try valid, invalid,
duplicate, and edge-case values where the UI permits. Look for unclear matching behavior, lost
changes, inaccessible controls, inconsistent counts, and visual defects.

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
