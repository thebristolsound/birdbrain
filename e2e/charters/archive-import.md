# Archive import charter

**Status: blocked for automated execution.** Two prerequisites are missing, and neither is
something a session can work around:

- **The import dialog is a native OS modal.** Import begins at `dialog.showOpenDialog` in
  `src/main/ipcHandlers.ts` (`CASES_INSPECT_ARCHIVE`). Every harness tool acts on the
  Playwright `Page`, which cannot see or click a native modal. A session that clicks Import
  will hang on a dialog it has no way to dismiss.
- **There is no sample archive.** `e2e/fixtures/` holds the launch fixture and seeding
  helpers but no archive, and every run starts from an empty `mkdtemp` profile, so there is
  nothing to import.

Unblocking needs a versioned `.birdbrain` fixture archive plus a harness action that hands the
main process a file path without going through the modal. Until both exist, run this charter
by hand: build an archive by exporting a case from a scratch profile, launch the app yourself,
and use the real file picker.

Everything below describes the charter's intent for that manual run, and for the automated run
once it is unblocked.

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
