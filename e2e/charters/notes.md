# Notes charter

**Persona:** An investigator recording and revising observations while moving through a case.

## Goal

Exercise the notes workflow end to end: create a rich-text note, use formatting, save it, search
for it, edit it, navigate away and back, and delete it. Deliberately probe for lost drafts or
edits, unclear save state, broken rich-text behavior, search surprises, and visual defects.

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
