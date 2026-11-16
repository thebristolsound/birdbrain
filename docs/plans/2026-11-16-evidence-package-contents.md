# Evidence Package contents decided once

**Status:** active

Written 2026-11-16 against `origin/main` at `2aac9a32`. Every source file here is on the
blocking tier of the evidence path list, so each pull request after the first carries
`evidence-affecting` and waits for the maintainer's review.

## Decision

One module decides what an export encloses: the Package Contents. It takes the
chain entries the package vouches for, the rows in the export's scope and a byte source, and
returns which files are enclosed, under which package path, with their bytes. The report, the
index (`evidence.json`), the Certification and the zip read that one result.

Before this, `generateReport` in `src/main/services/export.ts` decided contents in three
passes that a comment kept equal: `buildTimestampTokenPaths` (called twice),
`buildPackagedPaths` for the report, and the Capture pass of `buildEvidenceZip` for the zip.
The comment on `buildPackagedPaths` recorded that the report could name a file the zip lacked.

## Rulings

Three interface designs were drawn before any code, each under a different constraint: the
smallest interface, the easiest read for each consumer, and a rule table over a port. All
three chose a new package, one synchronous call, and results that carry their bytes.

1. **Placement.** A new package, `src/packages/evidence-package-contents/`. It does not go in
   `evidence-package-layout`, because Package Verification, `verify.sh` and the Verify Runbook
   import that package and must not read the writer's decision (ADR-0004). It does not go
   beside `export.ts`, because the package rules force tests through the interface, which is
   what makes the in-memory byte source exist. The dependency-cruiser rule
   `verification-does-not-read-package-contents` refuses any import that reaches the package
   from a verifier, directly or through another module.
2. **The per-Exhibit answer is the source.** The module answers by row id
   (`ofCapture`, `ofFileExhibit`), because three of the four consumers ask about one Exhibit,
   and only a per-Exhibit answer can say that a file was left out. The ordered lists the zip
   writes are built in the same call from the same answers.
3. **The byte source is a port with two adapters.** `caseDirectoryByteSource` in `export.ts`
   reads the Case directory. Tests pass a map. `readOnce` gives each file one read per export
   and repeats the first answer, a failed read included.
4. **The failure rule is in the port's contract.** A non-Capture Exhibit or a Derived File
   that cannot be read is not enclosed, and the export carries on. That is what
   `createPackageReader` did. Slice 3 adds a Capture's own files, where a file that exists and
   cannot be read fails the export.
5. **Chain names stay an input.** `resolveChainNames` stays in `export.ts`. Entry signatures,
   notes, the signed selection and the Shared Case exclusions read it too, and none of those
   is a contents decision.
6. **One module for both export classes.** An Evidence Package, a Working Copy and a
   standalone report differ in what they enclose, and that difference is the decision this
   module holds. A Working Copy encloses no Timestamp Token.
7. **No ADR.** Nothing here reverses a prior decision. The known-answer test is the record.

## Proof

`tests/main/services/exportKnownAnswer.test.ts` pins every byte of nine exports: an Evidence
Package with and without screenshots and with every option off, a selection export, a Working
Copy with every option on but burned annotations and with every option off, a standalone
report, a Case whose rows an import renamed, and a Shared Case with an `exclude` entry. Each
slice after the first leaves `tests/fixtures/export-known-answer/answers.json` unchanged.

The fixture does not cover burned annotations or thumbnails made by the image library, whose
encoded bytes differ between machines.

## Slices

- [x] **1. Pin the known answers.** Test only.
- [ ] **2. Move the decision for Timestamp Tokens, non-Capture Exhibits and Derived Files.**
      These already had one read each, so this is a move behind the new interface.
      `buildTimestampTokenPaths`, `createPackageReader`, `buildDerivedFiles` and
      `addDerivedFiles` leave `export.ts`.
- [ ] **3. Move the decision for a Capture's own files.** The page archive, the screenshot,
      the Transaction Record and the PDF, from one table of which signed field anchors which
      file. Each file is read once. `buildPackagedPaths`, the second screenshot digest loop in
      `generateReport` and the Capture pass of `buildEvidenceZip` leave `export.ts`, and the
      zip builders write the module's ordered lists.

Not planned: the five restatements of "a signed hash needs its enclosed file" in the
verifiers stay, because ADR-0004 asks for them. `caseArchive.ts` is not touched.

## Behaviour differences

Each is a difference only when a file changes or fails while an export runs.

- **Slice 2.** A failed read of a stored path is remembered for the rest of the export.
  `createPackageReader` cached only successful reads, so a second row with the same stored
  path could read a file that the first row was told was absent.
- **Slice 2.** A Working Copy no longer computes Timestamp Token paths. It never enclosed a
  token and no Working Copy document printed the path.

## Handoff

- **Shipped:** nothing merged yet.
- **In flight:** slice 1 and slice 2 are written. Slice 2 is stacked on slice 1.
- **Next command:** after slice 1 merges,
  `git rebase origin/main refactor/evidence-package-contents`, then
  `pnpm test tests/main/services/exportKnownAnswer.test.ts` and `pnpm preflight`.
- **Open questions:** none.
