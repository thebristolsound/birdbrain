# Archive import charter

**Persona:** A forensic examiner receiving a Birdbrain case archive from another investigator.

## Goal

Import an available sample archive, inspect the resulting case and evidence, search its content,
and probe duplicate or invalid import paths where safe. Look for missing provenance, unclear
errors, partial imports, broken navigation, unexpected duplication, and visual defects.

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
