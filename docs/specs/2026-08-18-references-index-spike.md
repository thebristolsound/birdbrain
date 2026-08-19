# References-index spike: Mention extraction over real case data

Date: 2026-08-18
Tracks: [#388](https://github.com/thebristolsound/birdbrain/issues/388) (spec
[#382](https://github.com/thebristolsound/birdbrain/issues/382), stage 2). Gates
[#389](https://github.com/thebristolsound/birdbrain/issues/389).

Run against `main` at `8470863`. Script: `scripts/spikes/references-index-388.ts` (run
instructions in its header; it copies the database it is pointed at and never writes the source).
Data: the maintainer's live `birdbrain.db` (schema v27; 3 cases, 56 captures, 9 selectors, 2 tags,
6 notes of which 4 are rich). Real note volume is far below the scale the question needs, so real
rows were kept as the target pool (captures, selectors, tags, the existing notes) and 5,000
synthetic notes were written into the largest real case with realistic mention density, plus four
oversized documents up to 1.4 MB.

## Verdict

**Extract at save time, synchronously, in the main process, inside the note-write transaction.
Approved.** Extraction itself is microseconds; the whole save path — parse, `check()`, extract,
text derivation, case-membership check, note write, index rewrite — is p50 0.7 ms / p95 2.2 ms /
p99 3.8 ms for a typical note and 46 ms for a 1.4 MB, 5,340-mention document. Nothing here needs
a worker, a queue, or renderer-side help.

## What was measured

Save path, per phase (ms), 5,000 typical notes (1–6 paragraphs, 0–4 mentions per paragraph, doc
size p50 2.3 KB / max 7 KB; 40,201 references written):

| Phase                            | p50       | p95       | p99       | max      |
| -------------------------------- | --------- | --------- | --------- | -------- |
| JSON.parse                       | 0.009     | 0.025     | 0.040     | 3.0      |
| `Node.fromJSON().check()`        | 0.012     | 0.035     | 0.059     | 3.6      |
| extract (walk JSON)              | 0.001     | 0.002     | 0.003     | 2.9      |
| extract (walk PM tree)           | 0.001     | 0.004     | 0.007     | 0.1      |
| `generateText` (existing cost)   | 0.246     | 0.585     | 1.342     | 10.2     |
| case-membership check (batched)  | 0.340     | 1.534     | 2.321     | 11.2     |
| note write + index delete/insert | 0.087     | 0.236     | 0.357     | 1.4      |
| **total**                        | **0.736** | **2.219** | **3.750** | **12.1** |

Re-saves of existing notes (autosave pattern, 2,000): total p50 1.6 ms / p95 3.2 ms; the case
check rises to p50 1.1 ms because the `note` target pool is now 5,000 rows.

Large documents (single save, 5 repeats):

| Doc                 | Mentions | check | text | case check | write | total |
| ------------------- | -------- | ----- | ---- | ---------- | ----- | ----- |
| 36 KB, 50 paras     | 124      | 0.12  | 0.41 | 1.9        | 1.0   | 3.6   |
| 137 KB, 200 paras   | 465      | 0.45  | 0.66 | 2.3        | 3.6   | 7.5   |
| 456 KB, 500 paras   | 1,659    | 1.4   | 1.5  | 6.7        | 12.0  | 20.0  |
| 1.4 MB, 1,000 paras | 5,340    | 3.3   | 2.7  | 6.8        | 28.0  | 45.9  |

Reads, over 47,617 references in one case (2,000 samples each):

| Query                                                                        | p50          | p95   | p99   |
| ---------------------------------------------------------------------------- | ------------ | ----- | ----- |
| Backlinks for a capture (27 captures share 5k notes → ~1,500 backlinks each) | 1.44         | 4.65  | 12.5  |
| Backlinks for a note                                                         | 0.012        | 0.038 | 0.080 |
| Outgoing refs of a note + per-ref resolve status                             | 0.013        | 0.035 | 0.104 |
| Backlink-count map for the whole case (4,277 targets)                        | 47.9 ms once |       |       |

Full re-extraction of every note in the case (repair / migration path): 5,009 notes in 345 ms.

Existing rich notes: all 4 real `body_doc` rows validate unchanged under the schema extended with
the Mention node — the addition is purely additive to `noteExtensions()`.

## Failure modes

| Input                                        | Result                                           | Note                                                                                 |
| -------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Mention with no attrs, PM `check()` only     | **accepted**                                     | `check()` enforces content expressions only; attrs with `default: null` pass as null |
| Mention with no attrs, full save path        | rejected                                         | needs an explicit attr validator — see constraint 1                                  |
| `targetType: 'bogus'`                        | rejected (validator)                             |                                                                                      |
| `targetId: 42`                               | rejected (validator)                             |                                                                                      |
| Mention at block level                       | rejected by `check()`                            | inline group holds                                                                   |
| Mention to a capture id that does not exist  | accepted                                         | dangling by design; resolves as broken on read                                       |
| Mention to a capture in another case         | rejected                                         | batched `json_each` membership check                                                 |
| Mention to a note in another case            | rejected                                         | same                                                                                 |
| Note mentioning itself                       | accepted                                         | harmless structurally; UI decision                                                   |
| Mention to a tag                             | accepted                                         | tags have no `case_id` — see constraint 3                                            |
| Unknown node type (renderer newer than main) | rejected by `fromJSON`                           | the version-gate #389 relies on already exists                                       |
| Delete the mentioned note                    | referrer keeps its ref; resolves `null` (broken) | no FK on target, so no cascade                                                       |
| Delete the referring note                    | its refs gone                                    | FK to `notes` `ON DELETE CASCADE`                                                    |
| Rejected re-save                             | index unchanged from previous save               | transaction rollback covers both tables                                              |
| Plain-text derivation                        | `@<label>`                                       | via `renderText`; searchable in FTS                                                  |

## Constraints for #389

1. **`parseNoteDoc` must validate Mention attrs explicitly.** ProseMirror's `check()` does not;
   a Mention with `targetType: null` is a schema-valid document. Validate `targetType ∈ {capture,
selector, tag, note}` and `targetId` a non-empty string, and throw the same way an off-schema
   body throws today. Do it in `parseNoteDoc` so archive import inherits it.
2. **Extract from the validated PM tree, not the raw JSON.** Both walks cost the same
   (microseconds) and agreed on every document, but the tree is what `check()` approved;
   extracting from it makes it impossible for the index to see a node the validator rejected.
3. **Tags cannot be case-scoped.** `tags` has no `case_id`; a tag is global and attaches to
   captures through `capture_tags`. Either accept any tag id (the spike does) or define "in this
   case" as "attached to at least one capture in this case" — the latter makes an ordinary
   tag-removal turn a valid Mention into a rejected one on the next save. **Recommend: accept any
   existing-or-not tag id; no case check for tags.** Record the choice on the ticket.
4. **Batch the case-membership check per target type**, one `WHERE id IN (SELECT value FROM
json_each(?))` statement per type per save. It is the largest phase (p50 0.3–1.1 ms) but stays
   under 7 ms even for 5,340 mentions; a per-mention query would be 5,340 round trips.
5. **No foreign key from the index to target tables.** A deleted target must stay representable
   as broken (#389 AC). FK from the index to `notes(id) ON DELETE CASCADE` only. Resolve status
   at read time (the `CASE target_type WHEN … (SELECT 1 …)` shape costs ~13 µs per note).
6. **Store `(note_id, ord)` as the primary key.** Duplicates and document order are preserved
   for free; backlink queries `GROUP BY note_id`.
7. **The index is derived, not source of truth.** A full rebuild from `body_doc` is 345 ms for
   5k notes, so the migration can create the table and populate it in the same block, and
   archive import can re-extract from the imported `body_doc` rather than carrying index rows.
   Only the Mention nodes need to travel in the archive; id remapping runs on their `targetId`
   attrs the same way `remapAnchorIds` runs on anchors today.
8. **A plain-text `body` write must clear the index too.** `resolveBody` already clears
   `body_doc` on a `body`-only write; the references for that note must go with it, in the same
   transaction.
9. **Backlinks on a heavily-referenced target are the slow read**, not the write: p99 12.5 ms
   for a capture with ~1,500 backlinks. Fine for a details panel; the Overview backlink map
   (#402) should use the aggregate count query (48 ms for a whole case) rather than one backlink
   query per target.
10. **Self-mention is structurally allowed.** Nothing breaks; whether the editor offers it is a
    #390 decision.

## Out of scope, noted

- Real installs have single-digit notes today; the 5,000-note case is a stress shape, not a
  forecast. Numbers above are ceilings.
- Mention labels are a display cache. Label refresh on target rename is a UI/read-time concern
  and was not measured; the identity model (`targetType`, `targetId`) means it never touches the
  index.
