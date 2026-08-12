# Two export classes: Evidence Package and Working Copy

The export dialog's presets resolve into two distinct export classes, not one package type with optional parts. An **Evidence Package** always contains its Certification and the full Manifest chain (ADR-0009) — those checklist rows render always-on and cannot be deselected. A **Working Copy** is a clearly-labelled non-evidentiary export — selected artifacts, extracted text, notes, and the browsable index, with no Certification and no evidentiary claims — for the Operator's own working use.

**Why the split exists:** the design-handoff prototype contradicted itself — its README declared the chain-of-custody cover sheet "always included" while its Working-copy preset code excluded it ("no custody paperwork"). Both instincts are right and they cannot live in one artifact class. The cover sheet is the existing Certification extended (nine fields + purpose-or-authority + signature rules — not a second overlapping operator statement), and a package whose Certification is omittable weakens the definition of every package: a receiving party could never assume from the format alone that an operator statement exists. Splitting the classes keeps the Evidence Package definition strong while preserving the legitimate "just give me my material" export.

**The trade-off accepted:** two regimes in one dialog is more product surface than one package type with checkboxes, and the Working Copy label must carry weight — a Working Copy handed to opposing counsel as if it were evidence is the failure mode. Mitigation is labelling, not capability: the Working Copy's report/index states it is a working export with no integrity certification, and it records no `export` Manifest Entry claiming evidentiary scope.

**Consequences:**

- The preset row maps: Full evidence bundle and Court exhibit are Evidence Packages (Court exhibit = excludes Notes); Working copy is the Working Copy class. Custom selections that deselect Certification/Manifest are only reachable inside the Working Copy class.
- Package Verification applies to Evidence Packages only; a Working Copy is not a verifiable object and the verifier should say so rather than FAIL.
- `CONTEXT.md` carries the glossary entry; UI copy, docs, and the export dialog use "Working Copy" exactly, never "draft export" or "partial package".
- Whether a Working Copy writes any Manifest Entry at all (e.g. a non-evidentiary `working-copy-export` record for the Operator's own audit trail) is left to the export-dialog spec; what is decided here is that it must not write an `export` entry indistinguishable from an Evidence Package's.
