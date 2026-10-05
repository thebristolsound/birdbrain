# Third-party verification ergonomics design

Date: 2026-09-20
Status: design, not implemented. Nothing below ships today.
Origin: maintainer session on 2026-09-20, prompted by a real handoff—a selection of Hunchly
captures sent to a journalist with the exact commands to check them. The question was whether
Birdbrain supports that workflow. It does; this document is about the distance between
supporting it and making it usable by the recipient.

## Problem

A recipient outside the investigation—a journalist, an editor, opposing counsel—receives an
evidence package holding a few Captures out of a larger Case and needs to answer one question:
are these what the sender says they are. Birdbrain already gives an honest answer to that
question. It does not give it quickly.

Three things stand between the package and the answer.

**The verdict arrives last.** `verify.sh` prints a line per check and its PASS, FAIL or
INCOMPLETE line at the end (`src/main/services/verifyScript.ts`). A recipient scrolling a
several-hundred-line transcript to find out whether it passed reads the whole thing as a problem
report.

**A selection looks like a failure.** Selection scope is recorded as its own signed property: the
export writes `scope: "selection"` and the selected ids into `export-entry.json`
(`src/main/services/export.ts`), and the verifier trusts that list only after the entry's
signature validates (`src/shared/verify/evidencePackage.ts`). Everything outside the selection is
then correctly reported as expected-absent—but one line at a time, per Capture, and per Exhibit
(`src/main/services/verifyScript.ts`). Three Captures selected from a two-hundred-Capture Case
produce a few hundred "expected absent" lines ahead of a PASS. The output is accurate and reads
like a catastrophe.

**The commands are not written down for this package.** `VERIFY.md` opens with a "One command"
section naming `verify.sh` (`src/main/services/verifyRunbook.ts`), and that section is correct.
It is followed by roughly three hundred lines of trust model and six hand-runnable steps, and the
published description of the package leads with the hand-runnable path rather than the one
command (`website/content/docs/index.mdx`). A sender who wants to paste two lines into an email
composes them by hand.

## Constraints

- **No new verification claim.** Every change below is presentation. What `verify.sh` checks,
  what it refuses to fold into a PASS, and the boundary between a structural timestamp check and
  canonical TSA authenticity are unchanged.
- **A skipped check is never folded into a pass.** The existing `INCOMPLETE` verdict and exit
  code 3 exist because a check that could not run is neither a pass nor a failure. Summarizing
  expected-absent notes must not summarize away an `INCOMPLETE`.
- **Claim discipline.** Anything written into the package states what it proves and what it does
  not, per the writing guide and ADR-0004. A package-level signature check is not a chain
  verification and must not be worded as one.
- **Evidence path.** These files are generated into the package a third party verifies, so the
  change is evidence-affecting: human review, no auto-merge, and the standalone verifier learns
  any new artifact before a build writes one (ADR-0023).

## Decisions

| #   | Decision                        | Chosen                                                                                                                                              |
| --- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Verdict placement               | `verify.sh` prints a one-line verdict header first, then the per-check detail, then the existing full verdict block. The trailing block is unchanged. |
| 2   | Out-of-selection reporting      | One summary line naming the counts, replacing the per-Capture and per-Exhibit notes. The per-item detail moves behind a `-v` flag.                     |
| 3   | Generated command sheet         | A new `HOW-TO-VERIFY.txt` at the package root: the literal commands for this package, its counts, and the two-sentence statement of what a PASS means. |
| 4   | Runbook ordering                | `VERIFY.md` keeps the one-command section at the top; the six steps move under a "Verify by hand" heading that says who it is for.                     |
| 5   | Published description           | `website/content/docs/index.mdx` leads with the one command and mentions the hand-runnable steps second.                                               |
| 6   | Detached package signature      | Deferred to a follow-up. See the Deferred section.                                                                                                              |

## Design

### Verdict header

The verdict is not known until the last check has run, so the script cannot print it
first. It buffers the per-check lines to a temporary file, prints the verdict line, then prints
the detail. The script already uses `mktemp` and already cleans up on an `EXIT` trap, so this
adds no new required tool.

The header states the verdict, the package scope and the counts:

```
verify.sh: PASS - 3 of 200 captures, selected and signed by the operator.
```

FAIL and INCOMPLETE headers name the failing or incomplete step numbers, which the script
already tracks.

### Selection summary

Today every Capture and Exhibit outside the signed selection emits its own note. That becomes
one line, stating that the omission is the operator's signed choice rather than a gap:

```
   3 of 200 captures are enclosed. The other 197 are outside the signed export
   selection and are expected absent - their omission is declared in a signed
   entry, not inferred.
```

The existing per-item notes are retained behind `-v`, because a reader checking a specific
Exhibit Number needs to see that it was named. The summary counts and the verbose lines come from
the same loop, so they cannot disagree.

Deleted Captures keep their own separate note. A deletion and an out-of-selection omission are
different facts and the recipient should not have to work out which one applies.

### `HOW-TO-VERIFY.txt`

Plain text, package root, generated at export with this package's real filenames and counts. It
is not a second runbook: it is the command, the expected output, and the boundary of the claim.

The content is roughly:

- What this package holds, in counts.
- The one command, and what exit 0 means in two sentences.
- The `openssl ts -verify` caveat: a PASS becomes a trusted-time claim only once the step 6a
  fingerprint is checked against a source outside the package.
- A pointer to `VERIFY.md` for the hand-runnable steps and the full trust model.

Plain text rather than Markdown because it is meant to be pasted into a message, and because a
recipient opening it in Notepad should not read backtick fences.

### Runbook and site ordering

`VERIFY.md` already leads with the one command. The change is to the material after it: the trust
model and six steps get a "Verify by hand" heading stating that this section is for a reader who
does not want to run an enclosed script, or who is checking the script itself. That framing is
already in the one-command section's closing sentence—"a convenience, not the authority"—and
just needs to be where a reader looks first.

`website/content/docs/index.mdx` describes the export as a package "whose `VERIFY.md`
runbook reproduces the whole check with `sha256sum`, `openssl`, and `jq`". That sentence is true
and buries the point. It leads with the one command instead, and keeps the stock-tools claim as
the second half, because the stock-tools property is what makes the one command trustworthy.

## Deferred

**Detached package signature.** A `package.sig` over the archive bytes would give a recipient a
single stock command—`openssl dgst -sha256 -verify signing-public-key.pem -signature
package.sig case.zip`—before they run anything Birdbrain wrote. The ingredients exist: the
package already encloses `signing-public-key.pem` (`src/main/services/export.ts`) and already
carries a `packageHash` over the artifact index, signed in `export-entry.json` and checked
against that key (`src/shared/verify/evidencePackage.ts`). What is missing is a signature over
the archive itself rather than over the index inside it.

It is deferred because it is a format change rather than a presentation change, and because its
claim is narrow enough to mislead: it proves the bytes match the enclosed key, not that the chain
is intact, and the enclosed key proves nothing about identity unless its fingerprint was
published elsewhere. Worth doing, worth doing with its own review.

**Aligning the two verifiers.** `src/verifier/cli.ts` states that "binary-PASS is not the same as
runbook-PASS": the binary's timestamp checks are structural, while `verify.sh` runs canonical
`openssl ts -verify`. Nothing here closes that gap, and a recipient handed the binary still gets a
different result from a recipient handed the script. Closing it means giving the binary canonical
TSA verification, which is a larger change on the evidence path.

## Build order

1. Selection summary and `-v` flag in `verify.sh`. Self-contained, and the largest readability
   win for the handoff workflow.
2. Verdict header in `verify.sh`.
3. `HOW-TO-VERIFY.txt` generation, and the standalone verifier's awareness of the new file so an
   unexpected-file check does not flag it.
4. `VERIFY.md` and site ordering. Prose only.

## Testing

- Golden-output fixtures for `verify.sh` on a selection-scoped package and an unscoped one,
  asserting the summary counts and that `-v` reproduces the per-item lines.
- A fixture where a selection package is also INCOMPLETE, asserting the header names INCOMPLETE
  and exit code 3 survives the summarization.
- A fixture with both a deleted Capture and an out-of-selection Capture, asserting the two are
  reported separately.
- Package-shape assertions that `HOW-TO-VERIFY.txt` is present, listed where the index expects,
  and that its stated counts match the signed selection.

## Open questions

1. Whether `HOW-TO-VERIFY.txt` is hashed into the package index. It is generated content with no
   signed entry of its own, which is the same position `report.html` holds today.
2. Whether the `-v` flag is the right control, or whether the per-item lines should always be
   written to a file in the package directory instead, so no rerun is needed to get them.
