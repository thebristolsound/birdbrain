# AI Capture Analysis Tab — Design Spec

**Date:** 2026-04-12
**Status:** Draft

## Context

Birdbrain previously had an AI-powered entity extraction system (removed March 2026, migration v7) that automatically extracted entities from captures. The system was over-engineered for what was needed. The OpenRouter integration infrastructure (`sendPrompt`, `testApiKey`, `listModels`, `truncateForContext`) remains intact but unused — the AI settings UI is stubbed with a placeholder message.

This spec brings AI back in the simplest useful form: a per-capture analysis tab where investigators click a button to get an AI-generated assessment of a capture, informed by the case context and capture metadata. The system prompt is fully configurable by the user. Results are ephemeral by default with an option to save to the database or copy to a case Note.

## Goals

- Let investigators quickly understand what a captured page contains without reading it
- Keep AI entirely opt-in — requires the user's own OpenRouter API key
- Ship the thinnest viable integration: one prompt, one button, one output
- Build on existing OpenRouter infrastructure — no new AI providers or abstractions
- Create a foundation that can be extended later (multi-agent, streaming, auto-analysis)

## Non-Goals

- Multi-agent panels (deferred to a future iteration)
- Streaming token-by-token output
- Automatic analysis on capture arrival
- Entity extraction or structured data extraction
- Chat/conversational follow-up on analysis results

## Design

### Settings — AI Configuration

Revive the stubbed `AIConfig.tsx` component with three fields:

1. **OpenRouter API Key** — password input with show/hide toggle and "Test" button (uses existing `testApiKey`). Stored encrypted via Electron `safeStorage` (existing pattern).
2. **Default Model** — dropdown populated by existing `listModels` IPC call. Default: `anthropic/claude-sonnet-4`.
3. **Analysis System Prompt** — textarea for the system message sent with every analysis. Ships with a default prompt:

```
You are an expert investigative analyst reviewing web captures collected
as part of a digital investigation. Analyze the provided capture in the
context of the case description and metadata. Provide a clear, structured
assessment covering key findings, notable entities, potential risks, and
recommended next steps. Be concise but thorough.
```

The user can edit this to anything — forensic focus, cybersecurity focus, OSINT focus, or a custom prompt for their specific use case. This replaces the multi-agent concept with a simpler "bring your own prompt" approach.

### New Setting Field

Add to `BirdbrainSettings` in `src/shared/types.ts`:

```typescript
analysisSystemPrompt: string
```

Default value in `src/main/services/settings.ts`:

```typescript
analysisSystemPrompt: 'You are an expert investigative analyst reviewing web captures collected as part of a digital investigation. Analyze the provided capture in the context of the case description and metadata. Provide a clear, structured assessment covering key findings, notable entities, potential risks, and recommended next steps. Be concise but thorough.'
```

### Analysis Tab — CaptureViewer Integration

A new "✦ Analysis" tab added to the existing CaptureViewer tab bar, after the Metadata tab.

**Empty state (no API key):**
- Message: "Set up your OpenRouter API key in Settings to enable AI analysis"
- Link to Settings page

**Empty state (API key configured, no analysis run):**
- Centered ✦ icon
- "Analyze this capture" heading
- Brief description of what it does
- Model selector dropdown (defaults to `defaultModel` from settings)
- Purple "▶ Analyze" button

**Loading state:**
- Skeleton or spinner replacing the content area
- Analyze button disabled

**Results state:**
- Toolbar row: model selector, "↻ Re-analyze" button, "💾 Save" button, "📋 Note" button, token count
- Scrollable panel with rendered markdown (the AI's response)
- Footer: generation timestamp, save status ("⚡ Unsaved" / "✓ Saved")

**Error state:**
- Error message with details
- "Retry" button

### State Transitions

```
No API Key → [configure in settings] → Ready
Ready → [click Analyze] → Loading
Loading → [success] → Results (unsaved)
Loading → [failure] → Error
Results (unsaved) → [click Save] → Results (saved)
Results (unsaved) → [click Re-analyze] → Loading
Results (saved) → [click Re-analyze] → Loading → Results (unsaved, shows "Save Changes")
Results (any) → [click Note] → AddNoteModal pre-filled
Error → [click Retry] → Loading
```

### Data Model

**New type in `src/shared/types.ts`:**

```typescript
interface CaptureAnalysis {
  id: string
  captureId: string
  caseId: string
  content: string              // raw markdown from the AI
  model: string                // OpenRouter model ID used
  tokenUsage: {
    prompt: number
    completion: number
    total: number
  }
  createdAt: string            // ISO timestamp
  updatedAt: string            // ISO timestamp
}
```

### Database — Migration v15

Current schema version is v14. This adds migration v15.

**New table:**

```sql
CREATE TABLE IF NOT EXISTS capture_analyses (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT NOT NULL,
  token_usage TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_capture_analyses_capture ON capture_analyses(capture_id);
```

One row per capture (1:1 relationship). Re-analyzing and saving overwrites the existing row.

### Analysis Service

**New file:** `src/main/services/ai/analysisService.ts`

**Core function:**

```typescript
async function analyzeCapture(
  captureId: string,
  caseId: string,
  model: string,
  apiKey: string,
  systemPrompt: string
): Promise<{ content: string, tokenUsage: TokenUsage }>
```

**What it does:**

1. Load capture text content via `storage.getCaptureContent(captureId, 'txt')`
2. Load capture metadata from DB (URL, title, timestamp, HTTP status, format, operator)
3. Load case context from DB (name, description, type)
4. Construct the user message:
   ```
   ## Case Context
   Name: {case.name}
   Description: {case.description}
   Type: {case.type}

   ## Capture Metadata
   URL: {capture.url}
   Title: {capture.title}
   Captured: {capture.timestamp}
   Format: {capture.format}
   HTTP Status: {capture.httpStatus}
   Operator: {capture.operatorName}

   ## Capture Content
   {truncateForContext(textContent)}
   ```
5. Call `sendPrompt([{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], model, apiKey)`
6. Return `{ content: response.content, tokenUsage: response.usage }`

**CRUD functions:**

- `saveAnalysis(analysis: CaptureAnalysis): void` — INSERT into capture_analyses
- `updateAnalysis(id: string, content: string, model: string, tokenUsage: TokenUsage): void` — UPDATE content, model, token_usage, updated_at
- `getAnalysis(captureId: string): CaptureAnalysis | null` — SELECT by capture_id
- `deleteAnalysis(id: string): void` — DELETE by id

### IPC Channels

Add to `src/shared/ipc.ts`:

| Channel | Direction | Payload → Return |
|---------|-----------|------------------|
| `ai:analyze` | renderer → main | `{ captureId, caseId, model }` → `{ content, tokenUsage }` |
| `ai:saveAnalysis` | renderer → main | `CaptureAnalysis` → `void` |
| `ai:updateAnalysis` | renderer → main | `{ id, content, model, tokenUsage }` → `void` |
| `ai:getAnalysis` | renderer → main | `{ captureId }` → `CaptureAnalysis \| null` |
| `ai:deleteAnalysis` | renderer → main | `{ id }` → `void` |

The `ai:analyze` handler reads the API key and system prompt from settings internally — they are not sent from the renderer (the API key never crosses the IPC bridge).

### Preload Bridge

Add to `window.birdbrain.ai`:

```typescript
ai: {
  analyze: (captureId: string, caseId: string, model: string) => Promise<{ content: string, tokenUsage: TokenUsage }>
  saveAnalysis: (analysis: CaptureAnalysis) => Promise<void>
  updateAnalysis: (id: string, content: string, model: string, tokenUsage: TokenUsage) => Promise<void>
  getAnalysis: (captureId: string) => Promise<CaptureAnalysis | null>
  deleteAnalysis: (id: string) => Promise<void>
}
```

### Copy to Note

When the user clicks "📋 Note":

1. Open the existing `AddNoteModal` component
2. Pre-fill title: `"AI Analysis — {capture.title}"`
3. Pre-fill body: the analysis markdown content
4. Pre-fill `captureId`: link to the current capture
5. User reviews and saves — uses the existing note creation flow, no new infrastructure

### Renderer Components

**New file:** `src/renderer/components/captures/AnalysisTab.tsx`

- Manages local state: `analysis` (current results), `isLoading`, `error`, `savedAnalysis` (from DB)
- On mount: calls `getAnalysis(captureId)` to check for saved analysis
- Renders the appropriate state (empty, loading, results, error)
- Markdown rendering: add `react-markdown` as a new dependency (not currently in the project). Use it to render the AI's markdown response safely in React.

**Modified files:**
- `src/renderer/components/captures/CaptureViewer.tsx` — add Analysis tab to the tab bar
- `src/renderer/components/settings/AIConfig.tsx` — replace stub with full implementation
- `src/renderer/components/settings/SettingsView.tsx` — ensure AI Config tab is wired up

### React Query Integration

Add to `src/renderer/lib/queries.ts`:

- `analysisKeys.detail(captureId)` — query key for a capture's saved analysis
- `useAnalysisMutation()` — mutation for running analysis (invalidates on success)
- Query options for loading saved analysis when the tab opens

### Error Handling

- **No API key:** Show friendly empty state with link to Settings (not an error)
- **Invalid API key:** Show error from `testApiKey` response
- **Model not available:** Show error with suggestion to check model in Settings
- **Rate limited (429):** Existing retry logic in `sendPrompt` handles this (3 retries with exponential backoff)
- **Content too large:** `truncateForContext()` already caps at 100KB — safe by default
- **Network error:** Show error with Retry button

## Files to Create

| File | Purpose |
|------|---------|
| `src/main/services/ai/analysisService.ts` | Analysis orchestration + CRUD |
| `src/renderer/components/captures/AnalysisTab.tsx` | Analysis tab UI component |

## Files to Modify

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `CaptureAnalysis` type, add `analysisSystemPrompt` to `BirdbrainSettings` |
| `src/shared/ipc.ts` | Add `ai:*` IPC channel definitions |
| `src/main/services/database.ts` | Add migration v15 (capture_analyses table) |
| `src/main/services/settings.ts` | Add `analysisSystemPrompt` default |
| `src/main/ipcHandlers.ts` | Register `ai:*` handlers |
| `src/preload/index.ts` | Expose `ai.*` methods on `window.birdbrain` |
| `src/renderer/components/captures/CaptureViewer.tsx` | Add Analysis tab |
| `src/renderer/components/settings/AIConfig.tsx` | Replace stub with full implementation |
| `src/renderer/components/settings/SettingsView.tsx` | Ensure AI Config is wired up |
| `src/renderer/lib/queries.ts` | Add analysis query keys and mutation hooks |

## Existing Code to Reuse

| File | What to Reuse |
|------|---------------|
| `src/main/services/ai/openrouter.ts` | `sendPrompt`, `truncateForContext`, `testApiKey`, `listModels` |
| `src/main/services/settings.ts` | `getSettings`, `updateSettings`, encrypted API key storage |
| `src/renderer/components/notes/AddNoteModal.tsx` | Pre-fill and open for Copy to Note flow |
| `src/renderer/lib/queries.ts` | Existing mutation/query key patterns |

## Verification

1. **Settings flow:** Set API key → Test Connection → select model → edit system prompt → verify all persist on app restart
2. **Analysis flow:** Open a capture with text content → click Analysis tab → click Analyze → verify markdown output renders correctly with token count
3. **Save flow:** Run analysis → click Save → close and reopen the tab → verify saved analysis loads → click Re-analyze → verify new results show with "Save Changes" option
4. **Copy to Note:** Run analysis → click Note → verify AddNoteModal opens pre-filled → save → verify note appears in Notes tab linked to the capture
5. **Error handling:** Remove API key → verify friendly empty state → set invalid key → verify error message → test with very large capture → verify truncation works
6. **Database migration:** Verify migration v15 creates table correctly on fresh DB and upgrade from v14
7. **Run existing tests:** `pnpm test` — ensure no regressions
