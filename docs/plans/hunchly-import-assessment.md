# Hunchly Case Import — Feasibility Assessment

**Date:** 2026-04-03
**Analyzed export:** `Brett Stevens Hunchly.zip` (Hunchly v2 case export)
**Author:** Matt Donovan

---

## 1. Executive Summary

Importing Hunchly case exports into Birdbrain is **highly viable**. The core investigation data — captures, tags, selectors, and selector matches — maps nearly 1:1 to Birdbrain's existing schema. The main gaps are **notes**, **attachments**, and **scraped photos/EXIF**, which require new tables and UI. Notes should be prioritized as they carry the investigator's analytical work product.

---

## 2. Hunchly Export Format

A Hunchly export is a ZIP archive containing:

```
├── case_data/                  # JSON metadata (the "database")
│   ├── cases.json              # Single case object
│   ├── pages.json              # All captured pages
│   ├── tags.json               # Tags defined for the case
│   ├── tagged_pages.json       # Tag-to-page junction table
│   ├── tagged_photos.json      # Tag-to-photo junction table
│   ├── selectors.json          # Text/regex selectors
│   ├── selector_hits.json      # Selector-to-page matches
│   ├── notes.json              # Investigator notes attached to pages
│   ├── important.json          # Flagged/starred pages
│   ├── case_attachments.json   # Manually added file metadata
│   ├── case_todo.json          # Investigation to-do items
│   ├── photos.json             # Scraped image metadata + EXIF
│   ├── photo_urls.json         # Original URLs for scraped images
│   ├── pages_to_photos.json    # Photo-to-page relationships
│   ├── data_extractors.json    # Regex-based data extractors
│   ├── data_records.json       # Unique extracted data items
│   ├── data_matches.json       # Extractor match-to-page junction
│   ├── search_engines.json     # Search engine definitions
│   ├── search_engine_searches.json  # Tracked search queries
│   ├── pages.csv               # CSV mirror of pages.json
│   ├── photos.csv              # CSV mirror of photos.json
│   ├── tagged_photos.csv       # CSV mirror of tagged_photos.json
│   └── attachments.csv         # CSV mirror of attachments
├── pages/                      # Per-page capture files
│   ├── {id}.mhtml              # Full page archive (MHTML format)
│   ├── {id}.jpeg               # Page screenshot
│   ├── {id}.code               # Page source code (JavaScript)
│   └── {id}.mhtml.sig          # PGP signature for integrity
├── photos/                     # Scraped images (hash-named files)
├── attachments/                # Manually added files (PDFs, images, etc.)
├── note_screenshots/           # Screenshots associated with notes
├── tagged_photos/              # Copies of photos that have tags
├── report/                     # Static assets for report.html
├── report.html                 # Pre-generated Hunchly HTML report
├── public.key                  # PGP public key for signature verification
└── deletion.log                # Audit log of deleted items
```

### Scale of the analyzed export

| Data type | Count |
|---|---|
| Captured pages | 1,166 |
| Page files (mhtml + jpeg + code + sig) | 4,398 |
| Notes | 80 |
| Tags | 6 |
| Tagged pages | 2 |
| Selectors | 87 |
| Selector hits | 5,533 |
| Flagged ("important") pages | 129 |
| Attachments | 61 |
| Scraped photos | 5,914 |
| Photo-to-page relationships | 13,421 |
| Extracted data records | 2,313 |
| Data extractor matches | 6,059 |
| Search queries tracked | 32 |
| To-do items | 2 |

---

## 3. Field-Level Mapping

### 3.1 Cases (direct map)

| Hunchly `cases.json` | Birdbrain `cases` | Notes |
|---|---|---|
| `case_name` | `name` | Direct |
| `created_date` | `created_at` | Reformat from .NET datetime |
| `created_date` | `updated_at` | No separate update field in Hunchly |
| `Information[].value` (Reference Number) | `description` | Could store as description |
| — | `type` | Default to `'custom'` |
| — | `archived` | Default to `0` |

Hunchly exports contain a single case per ZIP. The `created_username` and `reference_postfix` fields have no Birdbrain equivalent but could be stored in the description.

### 3.2 Captures / Pages (direct map)

| Hunchly `pages.json` | Birdbrain `captures` | Notes |
|---|---|---|
| `id` | — | Used for internal ID remapping only |
| `case_id` | `case_id` | Remapped to new Birdbrain case UUID |
| `url` | `url` | Direct |
| `title` | `title` | Direct (some have UTF-8 encoding artifacts) |
| `content_hash` | `hash` | Direct — both use SHA-256 |
| `timestamp_created` | `timestamp` | Reformat from ISO 8601 |
| `timestamp_created` | `created_at` | Same |
| — | `html_path` | Path to imported `.mhtml` file |
| — | `screenshot_path` | Path to imported `.jpeg` file |
| `tags` | — | Always null in JSON; tags come from `tagged_pages.json` |
| `is_important` | — | No equivalent (see section 4.2) |

**File mapping per page:**
- `pages/{id}.mhtml` → stored as capture HTML content (see MHTML discussion below)
- `pages/{id}.jpeg` → stored as capture screenshot
- `pages/{id}.code` → page source code (no Birdbrain equivalent, could be discarded)
- `pages/{id}.mhtml.sig` → PGP integrity signature (no equivalent)

### 3.3 Tags (direct map)

| Hunchly `tags.json` | Birdbrain `tags` | Notes |
|---|---|---|
| `id` | — | Internal, remapped |
| `tag_name` | `name` | Direct |
| — | `color` | Default to null; no color in Hunchly |

| Hunchly `tagged_pages.json` | Birdbrain `capture_tags` | Notes |
|---|---|---|
| `TagID` | `tag_id` | Remapped |
| `PageID` | `capture_id` | Remapped |

### 3.4 Selectors (direct map)

| Hunchly `selectors.json` | Birdbrain `selectors` | Notes |
|---|---|---|
| `ID` | — | Internal, remapped |
| `CaseId` | `case_id` | Remapped |
| `Selector` | `pattern` | Direct |
| `IsRegex` | `is_regex` | Direct |
| — | `enabled` | Default to `1` |
| — | `label` | Could duplicate `Selector` value as label |

| Hunchly `selector_hits.json` | Birdbrain `selector_matches` | Notes |
|---|---|---|
| `SelectorID` | `selector_id` | Remapped |
| `PageID` | `capture_id` | Remapped |

---

## 4. Features Requiring New Development

### 4.1 Notes (priority: high)

**What Hunchly provides:**
```json
{
  "ID": 7,
  "PageId": 375,
  "CaseId": 3,
  "Note": "Brett Stevens cited as Editor and author of the Preface...",
  "NoteDate": "2024-11-23T04:12:46.1206299Z",
  "Page": { /* embedded page object */ }
}
```

Notes are the investigator's analytical work product — observations, connections, and context that cannot be derived from the captured pages alone. This export contains 80 notes, many with substantial investigative commentary. There are also 74 note screenshots in the `note_screenshots/` directory (keyed by page ID as `{id}.jpeg`).

**Required work:**
- New `notes` table: `(id TEXT PK, capture_id TEXT FK, case_id TEXT FK, text TEXT, created_at TEXT)`
- Schema migration (version 9)
- IPC channels: `notes:list`, `notes:create`, `notes:update`, `notes:delete`
- UI: notes panel within the capture detail view
- Import mapping: straightforward — `PageId` remaps to `capture_id`

### 4.2 Important / Flagged Pages (priority: low)

129 pages are flagged as "important" in Hunchly. The simplest approach is to create an auto-tag named `"important"` or `"flagged"` during import and apply it to these captures. No new schema needed.

### 4.3 Attachments (priority: medium)

**What Hunchly provides:**
```json
{
  "ID": 70,
  "CaseId": 3,
  "Filename": "Chris Blanc Biography.pdf",
  "Source": "Added Manually",
  "Hash": "83377795...",
  "Description": "",
  "AttachedDate": "2024-12-18T08:17:03Z"
}
```

61 manually-added files (PDFs, images, ZIP archives) in `attachments/`. These are standalone evidence files the investigator collected outside of web browsing.

**Required work:**
- New `case_attachments` table: `(id, case_id, filename, hash, description, source, created_at)`
- File storage area within the case directory
- Basic attachment list UI in the case view
- Import mapping: copy files, remap IDs

### 4.4 Scraped Photos and EXIF (priority: low)

5,914 images scraped from captured pages, with original URLs and EXIF metadata (largely empty in this export). The `pages_to_photos.json` maps 13,421 photo-to-page relationships.

This is a large feature surface. The photos are already embedded in the MHTML captures, so importing them separately is redundant unless Birdbrain adds a dedicated image gallery or EXIF analysis feature.

**Recommendation:** Defer. The images exist within the MHTML page captures already.

### 4.5 Data Extractors / Matches (priority: low)

Hunchly has a built-in regex data extraction system (email addresses, Google Analytics IDs, tracking pixels, .onion addresses, etc.). This is conceptually similar to Birdbrain's selectors but more structured — extractors produce discrete data records rather than just flagging matches.

6 extractors, 2,313 unique data records, 6,059 matches across pages.

**Recommendation:** Defer. Birdbrain's selector system partially covers this. A future "data extraction" feature could import these.

### 4.6 Search Engine Searches (priority: low)

32 tracked search queries across Google, Twitter/X. Useful for investigation audit trails.

**Recommendation:** Defer or store as notes during import.

### 4.7 To-Do Items (priority: low)

2 items in this export. Minimal value for import.

---

## 5. Technical Considerations

### 5.1 MHTML Handling

Hunchly stores page captures as MHTML (Multipart MIME HTML) archives. These are self-contained files that include the HTML, CSS, images, and scripts in a single file. Birdbrain currently stores raw HTML.

**Options:**
1. **Store MHTML as-is** — Electron's `<webview>` tag and `loadURL('file:///path.mhtml')` can render MHTML natively. This preserves full fidelity. The `htmlPath` field would point to the `.mhtml` file; the renderer would need a minor conditional to handle MHTML vs HTML.
2. **Extract HTML body from MHTML** — Parse the MIME structure and extract just the HTML part. Lossy: embedded images and CSS would be lost. Not recommended.

**Recommendation:** Option 1. Store MHTML files as-is and add MHTML rendering support to the capture viewer.

### 5.2 ID Remapping

Hunchly uses auto-incrementing integer IDs. Birdbrain uses UUIDs. The import service must maintain an ID mapping table during import:

```
hunchlyPageId (int) → birdbrainCaptureId (UUID)
hunchlyTagId (int)  → birdbrainTagId (UUID)
hunchlySelectorId   → birdbrainSelectorId (UUID)
```

All junction tables (`tagged_pages`, `selector_hits`) must be remapped before insertion.

### 5.3 Hash Compatibility

Both tools use SHA-256 content hashes. Hunchly hashes match the `content_hash` field in `pages.json`. These can be imported directly into Birdbrain's `hash` column, preserving integrity verification capability.

However, Hunchly also has PGP signatures (`.mhtml.sig` files + `public.key`) for chain-of-custody verification. Birdbrain doesn't support PGP verification, but the signature files could be stored alongside captures for future use.

### 5.4 Character Encoding

Several JSON files contain UTF-8 multi-byte characters that cause issues when read with default Windows codepage (CP-1252). The import service must explicitly read all JSON files as UTF-8. Some titles also contain double-encoded UTF-8 sequences (e.g., `\u00c2\u00bb` instead of `»`) — these are Hunchly encoding artifacts that should be cleaned during import.

### 5.5 File Volume

A single Hunchly case export can contain thousands of files (this export has ~9,300+ files across all directories). The import service should:
- Use streaming/batched file copy operations
- Wrap database insertions in transactions (batch inserts)
- Report progress to the UI during import

---

## 6. Proposed Import Scope (Phased)

### Phase 1 — Core Import (covers ~80% of investigative data)

- Case metadata
- Pages → Captures (with MHTML + screenshot file copy)
- Tags + tagged pages
- Selectors + selector hits
- "Important" flag → auto-tag
- FTS index population from MHTML text extraction
- Progress reporting UI

### Phase 2 — Notes

- New `notes` database table + migration
- IPC channels for CRUD
- Import notes from `notes.json`
- Import note screenshots from `note_screenshots/`
- Notes panel in capture detail view

### Phase 3 — Attachments

- New `case_attachments` database table + migration
- File storage for case-level attachments
- Import from `case_attachments.json` + `attachments/`
- Basic attachment list UI

### Phase 4 (future) — Advanced Data

- Photo gallery with EXIF analysis
- Data extractor results
- Search query audit trail
- PGP signature verification

---

## 7. Estimated Complexity

| Component | Effort | New tables | New UI |
|---|---|---|---|
| Import service (ZIP + JSON + file copy) | Medium | 0 | Import dialog with progress |
| MHTML rendering support | Small | 0 | Conditional in capture viewer |
| Notes feature | Medium | 1 | Notes panel per capture |
| Attachments feature | Medium | 1 | Attachment list per case |
| Photo/EXIF gallery | Large | 2+ | Image gallery + EXIF viewer |

---

## 8. Conclusion

The Hunchly-to-Birdbrain import is not only viable but strategically valuable — it provides a migration path for investigators already using Hunchly. The data models are closely aligned, and the core import (Phase 1) can be built with no schema changes. Notes (Phase 2) is the highest-value new feature since it carries irreplaceable investigator analysis that doesn't exist anywhere in the captured pages themselves.
