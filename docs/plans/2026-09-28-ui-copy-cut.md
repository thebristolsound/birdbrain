# Cut design-session copy from the UI

Maintainer ask (2026-09-28): remove the descriptions and tooltips that read as if they were
ported from a design session. This list is the proposal; mark any row you disagree with.

Source: every renderer string of five or more words, pulled from `src/renderer/components/` and
`src/renderer/routes/` with the TypeScript AST (288 strings, at `origin/main` 3e009609). Rows marked **(E)** sit in a
blocking-tier file on the evidence-affecting path list, so the PR takes the `evidence-affecting`
label and a human review.

## 1. Cut

These describe the design, the implementation, or the product pitch instead of the screen.

| File | Text |
| --- | --- |
| `dashboard/cases/DataExplorer.tsx:65-75` **(E)** | Nav subtitles: "every Exhibit and Derived File in the case", "pooled files, not anchored (ADR-0024)", "grouped by stored file type", "files whose last verify did not pass", "the hash chain across the case" |
| `captures/AnnotationToolsTooltip.tsx:31` | "Drawing tools are now always live — pick the cursor to navigate, pick a shape to draw." |
| `settings/AppearanceConfig.tsx:96` | Density: "Scales padding, gaps, and row heights on … The dashboard and captures screens do not respond yet." |
| `signals/signalsModel.ts:118-123` | Auto-capture tooltip: "App-wide setting — it records whether … when it returns (#600)." |
| `signals/signalsModel.ts:169` | "Only these patterns are excluded for this case; the global ignore list …" |
| `signals/AutoCaptureCard.tsx:26,31` | "Case exclusions apply in addition to the global ignore list" / "Only this case's exclusions apply — …" |
| `signals/AutoCaptureCard.tsx:154` | "… A two-state switch cannot represent that, so it is locked here." |
| `signals/SignalDetailRail.tsx:108` | "Add a selector or a tag on the left. Selectors match text across every capture; tags are applied by hand." |
| `signals/SignalDetailRail.tsx:361` | "Adds matches found in captures this selector has not been run against. Existing matches are never removed." |
| `signals/BulkImportDrawer.tsx:84` | "blank · matching runs immediately after import" |
| `captures/CaptureMenu.tsx:155` | "Both run in the background queue" |
| `captures/WaybackCompare.tsx:46` | "Side-by-side reference — … Corroboration is your call; Birdbrain doesn't diff the two." |
| `captures/AnalysisTab.tsx:150` **(E)** | "Get an AI-generated assessment of this capture's content, informed by the case context and metadata." |
| `export/ExportDialog.tsx:290` **(E)** | Developer notation: "manifest export entry → scope: 'selection' · captureIds[…]. The Manifest chain itself ships complete." |
| `selectors/CreateSelectorCard.tsx:88` | "Define patterns to match across captures" |
| `dashboard/cases/NewCaseWizard.tsx:113` | "Set up your case details" |
| `dashboard/HeroSection.tsx:24` | "Capture web pages, organize evidence by case, and verify what changed over time." |
| `dashboard/ExtensionBanner.tsx:41` | "Your extension is connected and ready to capture." |
| `dashboard/DashboardFooter.tsx:13` | "Birdbrain v2.0.0 — Open-Source Intelligence Platform" (hard-coded version; the app is 1.0.1-beta.21) |
| `dashboard/RecentActivityFeed.tsx:105` | "No activity yet — captures and note edits land here." → "No activity yet" |
| `signals/SignalDetailRail.tsx:258` | "No captures yet — this signal hasn't matched." → "No matches yet" |
| `notes/NotesOverview.tsx:332` | "Notes are where you write up what a capture means. Start one and reference captures with @, selectors and tags with #." |
| `notes/NoteWorkspaceDetail.tsx:216-217` | Editor footer: "Markdown · TipTap editor · links captures & notes ·" |
| `settings/PersonasSection.tsx:79` | "A persona is a signed-in browser identity, yours or a pseudonym. Seed one from a cookie file …" (check the rest of the paragraph for a cookie-storage disclosure before cutting) |
| `captures/CaptureListEmptyState.tsx:35` | "Browse the web with the Birdbrain extension active to start collecting captures for this case." |
| `settings/About.tsx:18` | "Open source web investigation & capture tool" |

## 2. Trim: keep the fact, drop the rationale

| File | Keep | Drop |
| --- | --- | --- |
| `captures/WaybackPanel.tsx:239` | "Looking up this URL sends it to archive.org." | "Independent record of this URL. Corroboration only —" |
| `settings/OperatorConfig.tsx:191` **(E)** | "RFC 3161 timestamp server. Defaults to DigiCert." | "Captures never block on it; un-stamped captures are timestamped when the TSA is reachable." |
| `settings/OperatorConfig.tsx:192` **(E)** | "Not in use while trusted timestamping is off. Nothing is sent to this endpoint." | "Change it here so the authority is already the one you want when you switch timestamping back on." |
| `settings/OperatorConfig.tsx:210` **(E)** | "Cannot be changed." | "Stable device identifier - stamped on every capture and export." |
| `settings/UpdatesConfig.tsx:111-112` | "After restarting, reload the Birdbrain extension at …" | "— the update replaces its files, but Chrome keeps the old copy loaded until you do." |
| `settings/AIConfig.tsx:236` **(E)** | "Sent with every capture analysis." | "Customize for your investigation focus (forensics, OSINT, cybersecurity, etc.)." |
| `signals/AddSelectorRow.tsx:96-107`, `signals/AddTagRow.tsx:46` | "Add regex selector", "Add selector", "Add tag", "Regex" / "Exact text" | "— e.g. bc1[a-z0-9]{20,} — Enter to save and keep typing", "(or just wrap the pattern in /…/)" |
| `signals/BulkImportDrawer.tsx:60` | "One pattern per line — wrap in /…/ for regex." | "Paste straight from a spreadsheet or IoC feed." |
| `data/IndicatorsView.tsx:195` **(E)** | "No data extracted yet" title | "Extraction runs automatically on new captures. Click Reprocess to scan existing captures." |

## 3. Keep

Warnings before destructive actions, errors, evidence and privacy claims, and short input hints:
the deletion and manifest warnings on the captures route, tag delete and merge dialogs, the
database restore warnings, the export mode descriptions and the demo-case notice, the Wayback
"not evidence" banner, the TLS re-fetch caveat, the diagnostics deletion findings, the
report-a-problem privacy statement, the timestamping-off and cookie-store disclosures, the "closing this window does not stop the export" note, the unprotected signing-key warning, the legacy-capture
forensics note, placeholders, and keyboard hints such as "↑↓ to move · ⏎ to insert".

## 4. Onboarding (decide separately)

The dashboard quick-start guide, the captures getting-started panel, the welcome card and the
coach-mark tour (`onboarding/tourSteps.ts`) are explanatory text throughout. Options: delete them,
or leave them alone in this change.
