# Capture Viewer Layout Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure CaptureViewer from a broken 3-zone layout to a responsive 2-zone layout with tabs above content and tags inline in the header.

**Architecture:** Move sub-tabs from the bottom panel to a row between the header and content area. Move tags and position counter into the header row. Remove the bottom panel entirely. Make the content area fully responsive with `flex: 1 1 0` and `min-h-0`.

**Tech Stack:** React 19, Tailwind v4, Lucide icons (all existing — no new dependencies)

---

### Task 1: Move Sub-Tabs from Bottom Panel to Below Header

**Files:**
- Modify: `src/renderer/components/captures/CaptureViewer.tsx:190-256` (header area), `src/renderer/components/captures/CaptureViewer.tsx:328-405` (bottom panel)

- [ ] **Step 1: Cut the sub-tabs markup from the bottom panel and paste it below the header**

In `CaptureViewer.tsx`, move the sub-tabs row (lines 330-351) from inside the bottom panel `{/* C) Bottom panel */}` to directly after the closing `</div>` of the header bar (after line 256). The sub-tabs row becomes a second row in the fixed header area.

The moved block is:

```tsx
      {/* Sub-tabs row */}
      <div className="flex items-center gap-1 border-b border-border bg-surface px-3">
        {tabs.map((tab) => {
          const Icon = TAB_ICONS[tab]
          const isActive = activeTab === tab
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium transition-colors ${
                isActive ? 'text-accent' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {TAB_LABELS[tab]}
              {isActive && (
                <span className="absolute bottom-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-accent" />
              )}
            </button>
          )
        })}
      </div>
```

Place it immediately after the header `</div>` (line 256) and before the `{/* B) Content area */}` comment.

- [ ] **Step 2: Verify the app renders with tabs in the new position**

Run: `pnpm dev`

Open the captures tab for any case. Confirm sub-tabs appear between the header bar and the content area. The bottom panel will still exist (with just the tag bar) — that's fine for now.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/captures/CaptureViewer.tsx
git commit -m "refactor: move sub-tabs from bottom panel to below header in CaptureViewer"
```

---

### Task 2: Move Tags Inline into Header Row

**Files:**
- Modify: `src/renderer/components/captures/CaptureViewer.tsx:193-256` (header), `src/renderer/components/captures/CaptureViewer.tsx` (bottom panel tag bar area)

- [ ] **Step 1: Add tag badges and add-tag button between the title block and action icons in the header**

In the header bar (`{/* A) Viewer header */}`), insert a new tag section between the title `</div>` (end of `{/* Title + URL + timestamp */}`) and the `{/* Right side actions */}` div.

Replace the title block and right-side actions section (lines 210-255) with:

```tsx
        {/* Title + URL + position */}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-sm font-bold text-text-primary">
            {capture.title || hostname}
          </h2>
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[11px] text-text-muted">{capture.url}</span>
            <span className="shrink-0 text-[11px] text-text-faint">·</span>
            <span className="shrink-0 text-[11px] text-text-faint">
              {currentIndex + 1} / {captures.length}
            </span>
            <span className="shrink-0 text-[11px] text-text-faint">·</span>
            <span className="shrink-0 text-[11px] text-text-faint">← →</span>
          </div>
        </div>

        {/* Inline tags */}
        <div className="flex items-center gap-1.5 overflow-hidden">
          <TagIcon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
          {captureTags.map((tag) => (
            <TagBadge key={tag.id} tag={tag} onClick={() => handleToggleTag(tag.id)} removable />
          ))}
          <div className="relative shrink-0">
            <button
              onClick={() => setShowTagMenu(!showTagMenu)}
              className="flex items-center gap-1 rounded-lg border border-dashed border-border-strong px-2 py-1 text-[11px] text-text-muted hover:border-accent/30 hover:text-text-muted"
            >
              <Plus className="h-3 w-3" />
              Add tag
            </button>
            {showTagMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowTagMenu(false)} />
                <div className="absolute top-full left-0 z-50 mt-1 rounded-lg border border-border bg-elevated py-1 shadow-lg">
                  {allTags
                    .filter((t) => !captureTags.some((ct) => ct.id === t.id))
                    .map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => {
                          handleToggleTag(tag.id)
                          setShowTagMenu(false)
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs text-text-secondary hover:bg-elevated"
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: tag.color || '#f59e0b' }}
                        />
                        {tag.name}
                      </button>
                    ))}
                  {allTags.filter((t) => !captureTags.some((ct) => ct.id === t.id)).length ===
                    0 && <div className="px-3 py-1 text-xs text-text-muted">No more tags</div>}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-1">
          <ProvenanceBadge captureId={capture.id} />
          <button
            data-testid="add-note-button"
            onClick={() => setShowAddNote(true)}
            title="Add note"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-secondary"
          >
            <StickyNote className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleDownload}
            title="Download capture"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-secondary"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleOpenExternal}
            title="Open URL in browser"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-secondary"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            title="Delete capture"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
```

Key changes from the original:
- **Title subtitle line**: replaced `formatViewerTimestamp` with position counter (`currentIndex + 1 / captures.length`) and keyboard hints (`← →`), separated by `·` dots
- **Tag badges**: moved from bottom panel, with `TagIcon` label
- **Tag dropdown**: changed from `bottom-full mb-1` to `top-full mt-1` so it opens downward
- **Tag container**: has `overflow-hidden` to clip if too many tags; `+ Add tag` button has `shrink-0` to stay visible

- [ ] **Step 2: Delete the entire bottom panel**

Remove the entire `{/* C) Bottom panel */}` div (lines 328-405 in the original file — the exact lines will have shifted after Task 1). This is the `<div className="border-t border-border bg-surface">` block containing the (now-moved) sub-tabs and tag bar.

After deletion, the component structure should be:
1. `{/* A) Viewer header */}` — header row
2. Sub-tabs row (moved in Task 1)
3. `{/* B) Content area */}` — content
4. Delete confirm modal
5. AddNoteModal

- [ ] **Step 3: Remove unused code**

Delete the `formatViewerTimestamp` function (lines 53-61 in the original file) — it's no longer used since the timestamp was replaced by the position counter in the header subtitle.

Also delete the `const tabs = TABS` alias (line 181 in the original file) and replace `tabs.map` in the sub-tabs row with `TABS.map`.

- [ ] **Step 4: Verify tags and dropdown work in the new position**

Run: `pnpm dev`

Open a capture, verify:
- Tag badges appear in the header row
- Clicking `+ Add tag` opens the dropdown **downward**
- Adding/removing tags works
- Position counter and keyboard hints show in the URL line
- Bottom panel is gone

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/captures/CaptureViewer.tsx
git commit -m "refactor: move tags inline to header, remove bottom panel from CaptureViewer"
```

---

### Task 3: Fix Content Area Responsive Sizing

**Files:**
- Modify: `src/renderer/components/captures/CaptureViewer.tsx` (content area div)
- Modify: `src/renderer/components/captures/MhtmlViewer.tsx:51`

- [ ] **Step 1: Change the content area container classes**

Find the content area div (the `{/* B) Content area */}` section). Change its className from:

```tsx
<div className="flex-1 overflow-auto p-4">
```

to:

```tsx
<div className="flex-1 overflow-hidden min-h-0">
```

This makes the content area fill remaining space via flexbox while allowing it to shrink below its content size (`min-h-0`). Each tab will manage its own scrolling and padding.

- [ ] **Step 2: Wrap each tab's content in its own scrollable container with padding**

Replace the entire content area block with per-tab containers that each handle their own overflow:

```tsx
      {/* B) Content area */}
      <div className="flex-1 overflow-hidden min-h-0">
        {activeTab === 'screenshot' &&
          (content ? (
            <div className="h-full overflow-y-auto p-4">
              <div className="neu-card rounded-2xl overflow-hidden">
                {/* Fake browser chrome */}
                <div className="flex items-center gap-2 border-b border-border bg-elevated px-3 py-2">
                  <div className="flex gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
                    <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
                    <span className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
                  </div>
                  <div className="flex-1 rounded-md bg-surface px-3 py-0.5 text-[11px] font-mono text-text-muted truncate">
                    {capture.url}
                  </div>
                </div>
                <img src={`data:image/png;base64,${content}`} alt="Screenshot" className="w-full" />
              </div>
            </div>
          ) : (
            <div className="p-4 text-text-muted">No screenshot available</div>
          ))}
        {activeTab === 'page' && capture.format === 'mhtml' ? (
          <div className="h-full w-full overflow-hidden">
            <MhtmlViewer captureId={capture.id} />
          </div>
        ) : activeTab === 'page' ? (
          content ? (
            <iframe
              sandbox="allow-same-origin"
              srcDoc={content}
              className="h-full w-full border-0 bg-white"
              title="Archived page"
            />
          ) : (
            <div className="p-4 text-text-muted">No HTML available</div>
          )
        ) : null}
        {activeTab === 'source' &&
          (content ? (
            <div className="h-full overflow-y-auto p-4">
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-text-muted">
                {content}
              </pre>
            </div>
          ) : (
            <div className="p-4 text-text-muted">No HTML available</div>
          ))}
        {activeTab === 'text' &&
          (content ? (
            <div className="h-full overflow-y-auto p-4">
              <pre className="whitespace-pre-wrap font-mono text-sm text-text-muted">{content}</pre>
            </div>
          ) : (
            <div className="p-4 text-text-muted">No text content available</div>
          ))}
        {activeTab === 'metadata' && (
          <div className="h-full overflow-y-auto p-4">
            <div className="space-y-3 font-mono text-sm">
              <MetadataRow label="URL" value={capture.url} />
              <MetadataRow label="Timestamp" value={new Date(capture.timestamp).toLocaleString()} />
              <MetadataRow label="Hash (SHA-256)" value={capture.hash} />
              <MetadataRow label="Created" value={new Date(capture.createdAt).toLocaleString()} />
              {capture.headers && (
                <div>
                  <div className="text-text-muted">Headers</div>
                  <pre className="mt-1 whitespace-pre-wrap text-xs text-text-muted">
                    {capture.headers}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
```

Key changes per tab:
- **Screenshot**: wrapped in `<div className="h-full overflow-y-auto p-4">` — scrolls if image is taller than viewport
- **Page (MHTML)**: wrapped in `<div className="h-full w-full overflow-hidden">` — webview handles scroll
- **Page (iframe)**: removed `style={{ minHeight: '500px' }}`, removed `rounded-xl border border-border` classes, added `border-0` — iframe fills flex container
- **Source**: wrapped in `<div className="h-full overflow-y-auto p-4">`
- **Text**: wrapped in `<div className="h-full overflow-y-auto p-4">`
- **Metadata**: wrapped in `<div className="h-full overflow-y-auto p-4">`

- [ ] **Step 3: Remove minHeight from MhtmlViewer webview**

In `src/renderer/components/captures/MhtmlViewer.tsx`, line 51, change:

```tsx
      style={{ width: '100%', height: '100%', minHeight: '500px', background: 'white' }}
```

to:

```tsx
      style={{ width: '100%', height: '100%', background: 'white' }}
```

- [ ] **Step 4: Verify responsive behavior**

Run: `pnpm dev`

Test each tab:
1. **Screenshot** — resize the window vertically. Image should scroll within its container. No layout breakage.
2. **Page (iframe)** — iframe fills available space. No `500px` min-height gap.
3. **Page (MHTML)** — webview fills available space. No `500px` min-height gap.
4. **Source** — long source code scrolls within its own container.
5. **Text** — same as source.
6. **Metadata** — scrolls if content exceeds viewport.

Resize the window to various sizes. The content area should always fill remaining space. No bottom panel remnants.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/captures/CaptureViewer.tsx src/renderer/components/captures/MhtmlViewer.tsx
git commit -m "fix: make CaptureViewer content area fully responsive with no min-heights"
```

---

### Task 4: Run Tests and Lint

**Files:** None (verification only)

- [ ] **Step 1: Run unit tests**

Run: `pnpm test`

Expected: All existing tests pass. No CaptureViewer-specific unit tests exist, so this verifies no regressions in imports or shared types.

- [ ] **Step 2: Run linter**

Run: `pnpm lint`

Expected: No new lint errors. Fix any that appear (likely formatting).

- [ ] **Step 3: Run formatter**

Run: `pnpm format`

Expected: Files are formatted. If any files changed, stage and commit them.

- [ ] **Step 4: Commit if formatting changed files**

```bash
git add -A
git commit -m "style: format CaptureViewer after layout refactor"
```

(Skip this step if `pnpm format` made no changes.)
