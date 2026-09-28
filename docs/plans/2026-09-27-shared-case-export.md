# Shared Case export, import and fork (step 3)

Build step 3 of [collaborative Cases](../specs/2026-09-19-collaborative-cases-design.md)
(issue #1511). The verifier half landed in step 1: the package verifier already reads
`manifest.<installationId>.jsonl` beside `manifest.jsonl` and walks the Shared Case. This
step makes the writers produce those packages and archives, and adds fork from a replica.

## Fork shape (maintainer ruling, 2026-09-27)

A fork continues the old Owner's chain. The new Case's `manifest.jsonl` is the Owner's chain
followed by an `import` entry whose `sourcePublicKeyPem` is the Owner's key, signed by the
installation that imports. Every other member chain of the source Case travels as history under
`lineage/<sourceCaseId>/manifest.<installationId>.jsonl`, the forking member's own chain
included when it was not the Owner.

Any import of a Shared Case archive is a fork: the import path always makes a new Case with a
new id, and the new Case has one member until it is shared again. `case_members` stays empty
for it, and `cases.shared_at` and `owner_installation_id` stay null.

## Verifier

`verifySharedCase` learns that an `import` ends a roster:

- The current roster is read from the Owner chain's entries at or after its last `import`.
- When the entries before that `import` carry a `member-add`, they are verified as a Shared
  Case of their own under the import's `sourcePublicKeyPem`, with the lineage chains supplied
  for the import's `sourceCaseId`. The walk repeats for each earlier `import`, so a fork of a fork verifies.
- Lineage findings keep their outcome and name the lineage Case. Lineage members' accepted
  entries join `entries`, so the package verifier's active-Exhibit set covers them. Lineage
  citations and exclusions join the result, marked with their Case.
- The current generation's merge and citation walks skip the Owner's entries before the
  `import` when a lineage roster answers for them.
- Lineage chains supplied for a Case no `import` names are a `roster-invalid` finding.

`SharedCaseExclusion` gains the excluding entry's `timestamp` and `operatorName`, so the
package verifier's exclusion row and the export can name who excluded an Exhibit and when.

The package verifier reads `lineage/<caseId>/manifest.<id>.jsonl` and names manifest schema 4
in its `shared case` row. A verifier from steps 1 and 2 reads a fork as `roster-invalid`: no
Shared Case writer shipped before this step, so no such package exists yet.

## Writers

- **Package Layout.** Path helpers for member and lineage chain files, used by the case
  directory, the archive, the exporter, and the verifier.
- **Manifest.** One snapshot of every member and lineage chain in a case directory, and the
  Shared Case verification over it with the local key as the anchor.
- **Evidence Package.** Ships every member and lineage chain byte-for-byte. Remote Exhibits'
  bytes and index rows already ship, because `listExhibits` returns every author's rows; their
  trusted time and entry signatures now resolve from their author's chain. `evidence.json`,
  the report and the Certification list the members and every exclusion: the Exhibit, its
  author, the Owner who excluded it, when, and why. An excluded Exhibit still ships with its
  bytes. The exporting installation signs the Certification, as before.
- **Case Archive.** Schema 8. The archive carries every member and lineage chain and the
  `case_members` rows. Inspect verifies a Shared Case archive with the replica walk. Import
  builds the fork chain described in "Fork shape" and stamps every lineage Exhibit row with its author and Member
  Code, so while the fork has no roster of its own, its own Exhibits cannot cite the same as
  a lineage Exhibit. A roster it is later shared under could reuse a lineage code: the Member
  Code check reads only the fork's own roster.
- **Citation rule.** A Case with no roster whose rows carry Member Codes, which is a fork,
  prefixes those rows in the app and in exports.
- **VERIFY.md.** A Shared Case section naming manifest schema 4, the member chain files and
  the lineage directory.

## Tests

- Verify-core: a fork chain passes; a lineage finding surfaces with its Case; unnamed lineage
  is refused; a fork of a fork passes; a package with lineage chains passes.
- A two-member Case exports as an Evidence Package and passes the package verifier, including
  its `merge` heads.
- An export with an `exclude` lists the excluding Owner and time, and the excluded Exhibit's
  bytes and hash still verify.
- A fork from a non-Owner replica: the new chain is the Owner's chain plus an `import` naming
  the Owner's key, and the Shared Case walk over the new Case directory passes.

## Out of scope

- A fork action in the UI. The fork is a Case Archive export followed by an import; the
  Members UI is step 6.
- Id remapping on a same-machine import. When the source Case is still on the machine, import
  renames colliding row ids, and chain entries keep the old ids. This predates Shared Cases.
