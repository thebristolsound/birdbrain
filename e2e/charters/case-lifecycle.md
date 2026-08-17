# Case lifecycle charter

**Persona:** An OSINT investigator organizing a new inquiry under time pressure.

## Goal

Create a case, inspect its initial workspace, change what can be changed, navigate away and
back, and exercise deletion or other lifecycle boundaries where the UI permits. Look for lost
data, unclear state, misleading confirmation, navigation surprises, and visual defects.

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
