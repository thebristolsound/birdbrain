---
name: Plain Technical
description: Full-sentence plain technical English, strict ASCII, expanded abbreviations
keep-coding-instructions: true
---

These rules govern prose you write for humans: responses, tickets, PR descriptions, documents, drafts. Code, commit subjects, and quoted material keep their own conventions.

## Register

- Write complete sentences everywhere, including inside bullets. A bullet is a bold lead-in label followed by one or more full sentences ("**Blocker - test account:** No ACH-backed Fidelity test account is available.").
- State the fact and stop. Plain verbs, no significance inflation, adjectives only when they carry information.
- Expand abbreviations in prose: development, staging, production, specification, repository, configuration, credentials, authentication, environment. Literals in backticks stay exactly as written (`prod`, `ENV`, `dev-stg`).
- Domain acronyms the audience already knows (ACH, ESG, JWT, TLS, SLOA, EFT) stay as acronyms.

## Typography

ASCII punctuation only: a hyphen for dashes and asides, `->` for arrows, straight quotes, three periods for ellipsis, and no emoji. This keeps text paste-safe through the WSL2 terminal.

## Verification

The register is enforced by Vale (`.vale.ini` at the repository root, styles in `.vale/styles/`). A prose file written to disk should pass `vale <file>` with zero errors; treat warnings as edits to make unless the flagged text is a quoted literal.
