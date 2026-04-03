# Post-Removal Cleanup Design

**Date:** 2026-03-23
**Branch:** `feat/remove-sidebar-and-entity-extraction-clean`
**Status:** Approved

## Context

Birdbrain recently underwent a major simplification: the sidebar, AI entity extraction pipeline (OpenRouter-based), and rule-based entity extraction were all removed (~4,700 lines deleted). The core capture pipeline (Chrome extension → Hono server → SQLite + file storage) remains intact along with cases, captures, tags, selectors/pattern matching, search, and HTML export.

However, the removal left scars throughout the codebase: orphaned database tables, unused TypeScript types, settings UI for features that no longer exist, hardcoded-zero metrics in the case overview, entity references in dashboard components, and unimplemented action buttons in the capture viewer.

This cleanup finishes the job — removing all vestiges of the removed features, replacing broken metrics with useful ones, and implementing the missing capture viewer actions.

## Approach

Single sweep: one branch, one cohesive PR. Work bottom-up from database → types → UI → new functionality.

---

## 1. Database Migration (v7)

Add migration v7 to `src/main/services/database.ts`:

- Explicitly drop `idx_entities_capture_source` index
- Drop `entities` table
- Drop `case_analyses` table
- Increment `user_version` to 7

SQLite automatically drops indexes when their table is dropped, but naming the index explicitly (`idx_entities_capture_source`, created in migration v4) makes the migration self-documenting.

## 2. Type & Settings Cleanup

### Remove from `src/shared/types.ts`:
- `Entity` interface
- `EntityType` enum
- `'extraction_done'` from the `CaptureEvent.type` union
- From `BirdbrainSettings`: `autoExtractEntities`, `enabledEntityTypes`, `minEntityConfidence`, `sidebarWidth`

### Keep in `src/shared/types.ts`:
- `ExportOptions.format` union type retains `'pdf'` for future use
- `OpenRouterModel` — kept for future AI redesign

### Settings defaults cleanup in `src/main/services/settings.ts`:
- Remove default values for deleted settings fields from `DEFAULT_SETTINGS`
- Remove `EntityType` import

### Cascade cleanup:
- Remove imports of deleted types throughout the codebase
- Clean up any settings IPC handler references to removed fields
- Remove `'extraction_done'` event emission in `src/main/services/captureServer.ts`
- Remove `'extraction_done'` handling in `src/renderer/components/status/CaptureHealth.tsx`

## 3. CaseOverview & Dashboard Metrics Replacement

### CaseOverview Stat Cards
| Current (broken) | Replacement | Data source |
|---|---|---|
| Entities: 0 | **Tags** | Count of distinct tags on captures in this case (`capture_tags` join) |

### CaseOverview Sidebar Metrics
| Current (broken) | Replacement | Data source |
|---|---|---|
| AI Extraction Coverage: 0% | **Selector Coverage** | % of captures matched by ≥1 selector (`selector_matches` table) |

### Dashboard Components
- `CaseCard.tsx` — remove `entityCount` prop and its display
- `RecentCases.tsx` — remove `entityCount={0}` prop being passed to CaseCard
- `QuickStartGuide.tsx` — remove text referencing "entity extraction", "entity summaries", "relationship graphs", and "relationship maps"; replace with current feature descriptions

### Implementation:
- Add database query: count distinct tags for a case's captures
- Add database query: count captures with ≥1 selector match vs total captures
- Expose via existing IPC channels or add lightweight new ones
- Rename "Investigation Health" sidebar section to "Coverage"
- Update CaseOverview component to fetch and display the new metrics

## 4. CaptureViewer Actions

Three action buttons currently have `{/* TODO */}` placeholders (lines 179, 183, 187):

### 4a. Download
- New IPC channel: `captures:download`
- Backend: Uses Electron `dialog.showSaveDialog()` to let user choose destination, then copies the HTML file and/or screenshot from internal storage to the chosen path
- Frontend: Calls IPC on button click

### 4b. Open External
- New IPC channel: `captures:openExternal`
- Backend: Uses Electron `shell.openExternal(url)` to open the capture's URL in the default browser
- Frontend: Calls IPC on button click

### 4c. Delete
- Uses existing `captures:delete` IPC channel (or extends it)
- Backend: Reuse the existing `storage.deleteCaptureFiles(caseId, captureId)` utility in `src/main/services/storage.ts` to delete HTML/screenshot files from disk, then remove the DB record
- Frontend: Shows a React confirmation dialog (not Electron native) before calling IPC
- After deletion: navigate away from the deleted capture, refresh capture list

## 5. Settings Cleanup

- **Remove** `EntityExtractionConfig` component entirely
- **Remove** its tab/section from `SettingsView`
- **Stub** `AIConfig` — keep the component but replace contents with a "Coming Soon" message: "AI features are being redesigned. Stay tuned." Styled consistently with the rest of the settings panel.
- Remaining settings tabs: Appearance, Capture, AI (stubbed), Storage, About

## 6. Export Cleanup

- Remove the PDF format toggle from `ExportDialog` UI
- Default format to `'html'`
- Keep `'pdf'` in the `ExportOptions` type for future use

## 7. CSS Cleanup

- Remove dead CSS in `src/renderer/styles/globals.css` for entity graph node effects (keyframe animations and related styles)

## 8. CLAUDE.md Update

Update project documentation to reflect current reality:
- Remove references to AI pipeline, entity extraction services
- Update database tables list (remove `entities`, `case_analyses`)
- Update component listing (remove analysis components, EntityExtractionConfig)
- Remove `sidebarWidth` from settings references
- Note that AI features are in redesign

---

## Files Affected

### Deletions:
- `src/renderer/components/settings/EntityExtractionConfig.tsx`

### Modifications:
- `src/main/services/database.ts` — migration v7, add tag/selector count queries
- `src/main/services/settings.ts` — remove entity defaults from `DEFAULT_SETTINGS`, remove `EntityType` import
- `src/main/services/captureServer.ts` — remove `'extraction_done'` event emission
- `src/shared/types.ts` — remove Entity, EntityType, entity settings fields, sidebarWidth, `'extraction_done'` from CaptureEvent
- `src/shared/ipc.ts` — add `captures:download`, `captures:openExternal` channels
- `src/main/ipcHandlers.ts` — register new IPC handlers
- `src/preload/index.ts` — expose new channels
- `src/renderer/components/cases/CaseOverview.tsx` — replace metrics
- `src/renderer/components/captures/CaptureViewer.tsx` — implement action buttons
- `src/renderer/components/dashboard/CaseCard.tsx` — remove `entityCount` prop and display
- `src/renderer/components/dashboard/RecentCases.tsx` — remove `entityCount={0}` prop
- `src/renderer/components/dashboard/QuickStartGuide.tsx` — replace entity text with current features
- `src/renderer/components/settings/AIConfig.tsx` — stub with Coming Soon
- `src/renderer/components/settings/SettingsView.tsx` — remove entity extraction tab
- `src/renderer/components/export/ExportDialog.tsx` — remove PDF toggle
- `src/renderer/components/status/CaptureHealth.tsx` — remove `'extraction_done'` handling
- `src/renderer/env.d.ts` — remove entity-related declarations, add new capture action methods
- `src/renderer/styles/globals.css` — remove dead entity graph CSS
- `CLAUDE.md` — update documentation

### New (potentially):
- `src/renderer/components/captures/DeleteConfirmDialog.tsx` — React confirmation dialog for capture deletion (or inline in CaptureViewer)

---

## Explicitly Kept (Not Removed)

- `OpenRouterModel` type in `types.ts` — needed for future AI redesign
- `openrouter.ts` service — kept for future AI features
- OpenRouter settings IPC channels (`SETTINGS_TEST_OPENROUTER`, `SETTINGS_LIST_MODELS`) — kept for AI stub
- `'pdf'` in `ExportOptions.format` type — kept for future PDF generation

## Out of Scope

- Real PDF export generation (deferred to a future feature)
- New AI features (this is cleanup only)
- Database schema redesign beyond dropping unused tables
- Chrome extension changes (no orphaned code there after prior cleanup)
- Removal of OpenRouter infrastructure (explicitly kept for future AI redesign)

## Success Criteria

- No references to entities, entity extraction, or entity types remain in active code paths
- CaseOverview shows accurate, live metrics (Tags count, Selector Coverage %)
- Dashboard CaseCard no longer shows entity count
- QuickStartGuide text reflects current features, not removed ones
- All 3 CaptureViewer action buttons work: download saves files, open external launches browser, delete removes record + files
- Settings panel shows only active features (entity config gone, AI config stubbed)
- Export dialog shows only HTML format
- No dead CSS for removed features
- All existing tests pass
- CLAUDE.md accurately describes the codebase
