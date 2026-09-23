# Shared Case members table and Exhibit Number prefix display

Step 2 of the Shared Cases build order (#1508), ticketed as #1510. Contract:
`docs/specs/2026-09-19-collaborative-cases-design.md`, sections Working-layer rows and
Database, decision 7 (Exhibit Number) and decision 8 (Member Code). Step 1 (#1509) merged as
#1518 on 2026-09-20, so the schema-4 entry types and `verifySharedCase` exist; this step adds the
storage and the read-time citation rule and writes no schema-4 entry.

Blocking-tier evidence path (`src/main/services/db/**`, ADR-0014) with a schema migration, so
the PR carries `evidence-affecting` and waits for human review. Plan approval also waits
(ADR-0016 criteria 2, 3 and 6).

## Scope held to the ticket

- One migration, v35, created with `pnpm db:migration:new shared-cases`.
- The citation rule, applied on the surfaces the ticket lists: capture list, capture detail,
  Overview, note citations and exports.
- Member Code validation reuses `MEMBER_CODE_PATTERN` from `src/shared/schemas.ts`; nothing
  new is written.

Out of scope, named so the reviewer does not look for them: writing `memberCode` into a
Manifest `exhibit` entry (nothing makes a Case shared until step 5, so the first writer of a
`member-add` owns that), row signing on the working layer (step 4), every `sharing:` IPC
channel (steps 4 and 5), the Members UI (step 6).

## Migration v35

1. `case_members`: `case_id`, `installation_id`, `public_key_pem`, `member_code`,
   `operator_name`, `node_id`, `role`, `added_at_index`, `revoked_at_index NULL`. Primary key
   `(case_id, installation_id)`, `case_id` cascades from `cases`. A cache of the Owner's chain,
   rebuilt from `member-add` and `member-revoke` entries; never authoritative.
2. `exhibits` gains `member_code TEXT NULL` and `author_installation_id TEXT NULL`. SQLite
   cannot alter a table constraint, so the table is rebuilt the way v34 rebuilt the tag
   relation: create `exhibits_new`, copy, drop, rename, recreate `idx_exhibits_case_id`.
3. The uniqueness rule becomes a unique expression index,
   `(case_id, COALESCE(author_installation_id, ''), exhibit_number)`, not a table `UNIQUE`.
   SQLite treats NULLs as distinct inside a unique constraint, so a plain
   `UNIQUE (case_id, author_installation_id, exhibit_number)` would stop refusing two local
   Exhibits with one number. The existing v34 test "refuses a second Exhibit with the same
   number in a case" stays green under the index and fails under the constraint. Decision
   class: installed-API usage (ADR-0015), grounded in the SQLite NULL rule.
4. Working layer: `notes`, `annotations`, `tags`, `exhibit_tags` and `note_tags` each gain
   `author_installation_id TEXT NULL`, `version INTEGER NOT NULL DEFAULT 0`, `deleted_at TEXT
   NULL`, `row_signature TEXT NULL` by `ALTER TABLE ADD COLUMN`. Both tag-application tables
   are included because the spec says "tag applications" and the repo has two.
5. `cases` gains `shared_at TEXT NULL` and `owner_installation_id TEXT NULL`.
6. No row is rewritten. Every existing Exhibit keeps null member columns, read as "this
   installation".

## Read paths

- `src/main/services/db/caseMemberRepo.ts` (new): `listCaseMembers(caseId)`,
  `upsertCaseMember`, `getLocalMemberCode(caseId)`. Validation refuses a code outside
  `MEMBER_CODE_PATTERN` or already used in the Case.
- `src/main/services/db/exhibitRepo.ts`: `Exhibit` gains `memberCode: string | null` and
  `authorInstallationId: string | null`; `insertExhibit` fills both from the local roster row
  when the Case has one, null otherwise.
- `src/main/services/db/caseRepo.ts` and the `Case` type: `sharedAt` and
  `ownerInstallationId`, optional, mapped the way `caseNumber` is.
- `src/shared/exhibitCitation.ts` (new, pure): `formatExhibitCitation(exhibit, { prefixed })`
  returns `<memberCode>-<n>` when `prefixed` and the code is set, `n` otherwise. Decision 7:
  the app passes `prefixed = roster.length > 1`; exports pass `prefixed = memberCode !== null`.
  Every surface below calls this and none builds the string itself.

## Surfaces

- Capture list (`CaptureItem.tsx`): a 16px chip before the title (assessment item 22). The
  list renders no Exhibit Number today, so `listCaptures` joins the exhibit number and member
  code onto the row it already returns.
- Capture detail (`CaptureDetailsPanel.tsx`), Overview (`RecentCapturesStrip.tsx`), the Data
  screen strings in `ArtifactTable.tsx`, `PropertiesTab.tsx`, `DataExplorer.tsx` and
  `ledgerModel.ts`.
- Note citations: the anchor resolution in `src/shared/noteAnchor.ts` and the report citation
  strings in `reportHtml.ts` lines 414 and 429.
- Exports: `export.ts` and `certification.ts` carry the citation string beside the number so
  the Certification and the report print the prefix; the Manifest entry is untouched.

## Tests

- Migration fixture v34 to v35 in `tests/main/services/exhibitModel.test.ts`: existing
  Exhibits keep bare citations and null member columns; the column lists for the six tables
  and `cases` are pinned.
- Uniqueness: `NK-12` and `MB-12` coexist in one Case; a duplicate within one author, and a
  duplicate between two local (null author) rows, both throw `UNIQUE`.
- Member Code validation: length, character class, uniqueness per Case.
- A seeded two-member Case renders prefixed citations on every surface above; a one-member
  Case renders none in the app and does in an export.
- Diff coverage stays above the 90% gate (`pnpm preflight`).

## Files

Around 18 files, over the ADR-0016 ten-file line: `migrations.ts`, `core.ts`,
`caseMemberRepo.ts`, `exhibitRepo.ts`, `caseRepo.ts`, `captureRepo.ts`, `types.ts`,
`exhibitCitation.ts`, `noteAnchor.ts`, `reportHtml.ts`, `export.ts`, `certification.ts`,
`CaptureItem.tsx`, `CaptureDetailsPanel.tsx`, `RecentCapturesStrip.tsx`, the four Data screen
files, plus tests and `CONTEXT.md` for the Member Code term.

## Open points for the maintainer

1. Whether `note_tags` belongs in the working-layer column set (the spec names "tag
   applications"; the plan includes both tables).
2. Whether step 2 should also stamp `memberCode` on new `exhibit` Manifest entries once a
   roster exists, or leave that to the step that first writes `member-add` (the plan leaves
   it).
