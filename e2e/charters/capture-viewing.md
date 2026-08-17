# Capture viewing charter

**Persona:** A forensic researcher reviewing captured web evidence for the first time.

## Goal

Open available captures and explore the viewer, tabs, details rail, provenance and verification
controls at different window sizes. Look for clipped evidence, confusing labels, inaccessible
controls, inconsistent state, rendering defects, and anything that weakens confidence in what
was captured.

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
