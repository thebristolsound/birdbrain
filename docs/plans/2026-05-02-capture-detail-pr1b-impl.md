# Capture Detail PR1b — Forensics Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Rebuild the existing "Metadata" tab in `CaptureViewer` as a "Forensics" tab that surfaces the full forensic provenance chain captured via MHTML, with a legacy banner for older HTML captures, and shares the panel's Re-verify mutation hook.

**Architecture:** Extract the tab body into a new `ForensicsTab.tsx` component. The `CaptureViewer` keeps the shell (slim breadcrumb, sub-tabs row, content router) and delegates the body for the renamed `forensics` tab. Re-verify reuses `useVerifyMutation` (shipped in PR1a) so panel + tab share state and pulse together.

**Tech Stack:** React 19, TanStack Query, lucide-react icons, Tailwind v4 semantic tokens, Vitest (unit), Playwright + Electron (e2e).

**Source design:** `docs/plans/capture-detail-redesign.md` §8 (Forensics tab content) and §6/PR1b (files touched).

**Branch:** `feat/capture-detail-pr1b` (already cut from `master` at 9556d2a).

---

## Constraints / context

- TDD where reasonable; here the bulk is JSX rendering against a typed `Capture`, so the e2e spec is the meaningful test. No new unit hook to TDD — `useVerifyMutation` is already covered indirectly by `capture-detail-panel.spec.ts`.
- Section style follows panel conventions: `text-xs font-semibold text-text-faint uppercase tracking-wider` headers, `space-y-3.5` rows, `border-b border-border` between sections, `:last-child:border-b-0`.
- Hide rows whose value is `undefined` or empty string. Sections that are entirely mhtml-gated (hash chain, capture environment, operator) only render when `capture.format === 'mhtml'`.
- Status palette stays raw (`amber-*`, `red-*`, `emerald-*`) per `theme.md` — these are forensic state colors and don't theme-swap.
- No extension/server changes. Single-file rendering tab + e2e.

---

## File Structure

**Edit**

- `src/renderer/components/captures/CaptureViewer.tsx` — rename `metadata` → `forensics` in `ViewTab`/`TABS`/`TAB_ICONS`/`TAB_LABELS`, swap `Info` → `ShieldCheck`, replace inline metadata body with `<ForensicsTab capture={capture} caseId={caseId} />`.

**New**

- `src/renderer/components/captures/ForensicsTab.tsx` — props `{ capture: Capture; caseId: string }`. Renders legacy banner, then the six sections.

**Tests**

- `e2e/forensics-tab.spec.ts` — seed an mhtml capture and a legacy `format='html'` capture, switch to Forensics tab on each, assert the right sections render. Verify Re-verify button calls through and updates the panel shield.

---

### Task 1: Rename metadata tab to forensics

**Files:**
- Modify: `src/renderer/components/captures/CaptureViewer.tsx:7-41` (imports, `ViewTab` type, `TABS`, `TAB_ICONS`, `TAB_LABELS`).
- Modify: `src/renderer/components/captures/CaptureViewer.tsx:246` (the conditional `activeTab === 'metadata'`).

- [ ] **Step 1: Replace `Info` import with `ShieldCheck` and rename type/constants.**

```ts
import {
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Image,
  Globe,
  Code,
  FileText,
  ShieldCheck,
  Shield
} from 'lucide-react'

type ViewTab = 'screenshot' | 'page' | 'source' | 'text' | 'forensics'

const TABS: ViewTab[] = ['screenshot', 'page', 'source', 'text', 'forensics']

const TAB_ICONS: Record<ViewTab, typeof Image> = {
  screenshot: Image,
  page: Globe,
  source: Code,
  text: FileText,
  forensics: ShieldCheck
}

const TAB_LABELS: Record<ViewTab, string> = {
  screenshot: 'Screenshot',
  page: 'Page',
  source: 'Source',
  text: 'Text',
  forensics: 'Forensics'
}
```

- [ ] **Step 2: Update the body conditional from `activeTab === 'metadata'` to `activeTab === 'forensics'`.** (Body content gets replaced wholesale in Task 3 — for now keep the existing inline JSX but under the new tab key so the typecheck passes.)

- [ ] **Step 3: Run typecheck.**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/renderer/components/captures/CaptureViewer.tsx
git commit -m "refactor(captures): rename Metadata tab to Forensics + swap icon"
```

---

### Task 2: ForensicsTab component shell

**Files:**
- Create: `src/renderer/components/captures/ForensicsTab.tsx`.
- Modify: `src/renderer/components/captures/CaptureViewer.tsx` (replace inline body with `<ForensicsTab />`).

- [ ] **Step 1: Create `ForensicsTab.tsx` with the props skeleton and a placeholder body so the import compiles.**

```tsx
import type { Capture } from '@shared/types'

interface Props {
  capture: Capture
  caseId: string
}

export function ForensicsTab({ capture, caseId }: Props) {
  void caseId
  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      <div className="text-xs text-text-muted">{capture.id}</div>
    </div>
  )
}
```

- [ ] **Step 2: In `CaptureViewer.tsx`, swap the inline forensics body for `<ForensicsTab capture={capture} caseId={caseId} />` and drop the local `MetadataRow` helper.**

```tsx
{activeTab === 'forensics' && <ForensicsTab capture={capture} caseId={caseId} />}
```

- [ ] **Step 3: Confirm `caseId` is in scope inside `CaptureViewer` (already from `useParams({ from: '/cases/$caseId/captures' })`).**

- [ ] **Step 4: Run typecheck and tests.**

```bash
pnpm typecheck
pnpm test
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/renderer/components/captures/ForensicsTab.tsx src/renderer/components/captures/CaptureViewer.tsx
git commit -m "refactor(captures): extract ForensicsTab shell"
```

---

### Task 3: Legacy HTML banner + section primitives

**Files:**
- Modify: `src/renderer/components/captures/ForensicsTab.tsx`.

- [ ] **Step 1: Add a small `Section` and `Row` helper inside `ForensicsTab.tsx` (not exported). They keep section styling consistent and hide empty rows.**

```tsx
function Section({
  title,
  children,
  action
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <section className="border-b border-border px-5 py-4 [&:last-child]:border-b-0">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-faint">
          {title}
        </h3>
        {action}
      </div>
      <div className="space-y-3 font-mono text-xs">{children}</div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string | number | undefined | null }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div>
      <div className="text-text-faint">{label}</div>
      <div className="break-all text-text-secondary">{String(value)}</div>
    </div>
  )
}
```

- [ ] **Step 2: Replace the placeholder body with the legacy banner (rendered only when `capture.format === 'html'`).**

```tsx
return (
  <div className="h-full overflow-y-auto">
    {capture.format === 'html' && (
      <div
        className="mx-5 mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-500"
        data-testid="forensics-legacy-banner"
      >
        Legacy HTML capture — captured before forensic chain (v2). Hash present, chain metadata
        unavailable.
      </div>
    )}
    {/* sections go here in Task 4 */}
  </div>
)
```

- [ ] **Step 3: Typecheck.**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/renderer/components/captures/ForensicsTab.tsx
git commit -m "feat(captures): forensics tab section primitives + legacy banner"
```

---

### Task 4: Six forensic sections + Re-verify wiring

**Files:**
- Modify: `src/renderer/components/captures/ForensicsTab.tsx`.

Reference: design doc §8.

- [ ] **Step 1: Pull in `useVerifyMutation` and `getProvenanceColor` and render the six sections. Mhtml-only sections are gated on `capture.format === 'mhtml'`. The Re-verify button mirrors the panel button (same hook, so shared `mutationKey: ['verify-capture', captureId]`).**

```tsx
import { useState } from 'react'
import type { Capture } from '@shared/types'
import { useVerifyMutation } from './useVerifyMutation'
import { getProvenanceColor } from './getProvenanceColor'

interface Props {
  capture: Capture
  caseId: string
}

export function ForensicsTab({ capture, caseId }: Props) {
  const verify = useVerifyMutation(capture.id, caseId)
  const provenance = getProvenanceColor(capture.lastVerifiedStatus)
  const [headersOpen, setHeadersOpen] = useState(false)
  const isMhtml = capture.format === 'mhtml'

  const reverifyButton = (
    <button
      onClick={verify.verify}
      disabled={verify.isPending}
      className="rounded-md px-2 py-0.5 text-[11px] text-accent hover:bg-accent-subtle disabled:opacity-50"
      data-testid="forensics-reverify-btn"
    >
      {verify.isPending ? 'Verifying…' : 'Re-verify'}
    </button>
  )

  return (
    <div className="h-full overflow-y-auto">
      {capture.format === 'html' && (
        <div
          className="mx-5 mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-500"
          data-testid="forensics-legacy-banner"
        >
          Legacy HTML capture — captured before forensic chain (v2). Hash present, chain metadata
          unavailable.
        </div>
      )}

      {isMhtml && (
        <Section title="Hash chain" action={reverifyButton}>
          <Row label="Hash (SHA-256)" value={capture.hash} />
          <Row label="Previous hash" value={capture.prevHash} />
          <Row label="Entry hash" value={capture.entryHash} />
          <Row label="Manifest index" value={capture.manifestIndex} />
          <div>
            <div className="text-text-faint">Chain status</div>
            <div className={`flex items-center gap-2 ${provenance.text}`}>
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${provenance.dot} ${
                  verify.isPending ? 'animate-pulse' : ''
                }`}
              />
              <span>{provenance.label}</span>
            </div>
          </div>
        </Section>
      )}

      <Section title="Identity" action={!isMhtml ? reverifyButton : undefined}>
        <Row label="URL" value={capture.url} />
        <Row label="Title" value={capture.title} />
        <Row label="Captured at" value={new Date(capture.timestamp).toLocaleString()} />
        <Row label="Created at" value={new Date(capture.createdAt).toLocaleString()} />
        {!isMhtml && <Row label="Hash (SHA-256)" value={capture.hash} />}
      </Section>

      {isMhtml && (
        <Section title="Capture environment">
          <Row label="Tool version" value={capture.toolVersion} />
          <Row label="Extension version" value={capture.extensionVersion} />
          <Row label="Browser version" value={capture.browserVersion} />
          <Row label="User agent" value={capture.userAgent} />
          <Row label="HTTP status" value={capture.httpStatus} />
        </Section>
      )}

      {isMhtml && (capture.operatorName || capture.operatorId) && (
        <Section title="Operator">
          <Row label="Operator name" value={capture.operatorName} />
          <Row label="Operator ID" value={capture.operatorId} />
        </Section>
      )}

      {capture.headers && (
        <Section
          title="Headers"
          action={
            <button
              type="button"
              onClick={() => setHeadersOpen((v) => !v)}
              className="rounded-md px-2 py-0.5 text-[11px] text-accent hover:bg-accent-subtle"
            >
              {headersOpen ? 'Hide' : 'Show'}
            </button>
          }
        >
          {headersOpen && (
            <pre className="whitespace-pre-wrap break-all text-[11px] text-text-muted">
              {capture.headers}
            </pre>
          )}
        </Section>
      )}
    </div>
  )
}
```

Notes for the implementer:
- Legacy captures still get a Re-verify button (placed in the Identity section's action slot) because the underlying hash check still runs and may flip status.
- Operator section hides entirely when both fields are empty (the design says rows hide individually but a section with no rows would render an empty header — gate the section render too).
- The hash row appears in Hash chain for mhtml, in Identity for legacy, never both.

- [ ] **Step 2: Typecheck and run unit tests.**

```bash
pnpm typecheck
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add src/renderer/components/captures/ForensicsTab.tsx
git commit -m "feat(captures): forensics tab six sections + shared Re-verify"
```

---

### Task 5: e2e — `forensics-tab.spec.ts`

**Files:**
- Create: `e2e/forensics-tab.spec.ts`.

Use `e2e/capture-detail-panel.spec.ts` as the reference for fixture wiring (hash router, Hono server upload, viewport sizing). Keep one test that seeds two captures (one MHTML, one legacy HTML) and walks both.

- [ ] **Step 1: Write the spec.**

```ts
import { test, expect } from './fixtures/electronApp'

test.describe('Forensics tab', () => {
  test('renders chain sections for mhtml capture and legacy banner for html capture', async ({
    electronApp,
    page
  }) => {
    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Forensics E2E')
    await page.click('[data-testid="case-create-btn"]')
    await page.waitForSelector('[data-testid="case-header-name-btn"]', { timeout: 10000 })

    const caseIdMatch = page.url().match(/cases\/([^/]+)/)
    expect(caseIdMatch).toBeTruthy()
    const caseId = caseIdMatch![1]

    const serverToken = await page.evaluate(async () => {
      const r = await fetch('http://127.0.0.1:19845/api/status')
      const data = await r.json()
      return data.serverToken ?? ''
    })

    // Seed an MHTML capture with full forensic fields.
    await page.evaluate(
      async ({ caseId, token }) => {
        const form = new FormData()
        form.append('source', 'manual')
        form.append('caseId', caseId)
        form.append('url', 'https://example.com/forensics-mhtml')
        form.append('title', 'Forensics MHTML')
        form.append('timestamp', new Date().toISOString())
        form.append('textContent', 'mhtml body')
        form.append('extensionVersion', '0.1.0')
        form.append('browserVersion', 'Chrome/120')
        form.append('userAgent', 'Mozilla/5.0')
        form.append(
          'mhtml',
          new Blob(['<html><body>mhtml</body></html>'], { type: 'multipart/related' }),
          'capture.mhtml'
        )
        const r = await fetch('http://127.0.0.1:19845/api/captures', {
          method: 'POST',
          body: form,
          headers: { 'X-Birdbrain-Token': token }
        })
        return r.json()
      },
      { caseId, token: serverToken }
    )

    const win = electronApp.windows()[0]
    await win.setViewportSize({ width: 1400, height: 900 })

    await page.evaluate((caseId) => {
      window.location.hash = `/cases/${caseId}/captures`
    }, caseId)

    const item = page.getByTestId('capture-item').first()
    await item.waitFor({ timeout: 10000 })
    await item.click()

    // Switch to Forensics tab.
    await page.getByRole('button', { name: /forensics/i }).click()

    // Hash chain section + Re-verify present, identity rows visible.
    await expect(page.getByText(/^Hash chain$/i)).toBeVisible()
    await expect(page.getByText(/^Identity$/i)).toBeVisible()
    await expect(page.getByText(/^Capture environment$/i)).toBeVisible()
    await expect(page.getByTestId('forensics-reverify-btn')).toBeVisible()
    await expect(page.getByTestId('forensics-legacy-banner')).toHaveCount(0)

    // Re-verify click does not throw and ends in a non-pending state.
    await page.getByTestId('forensics-reverify-btn').click()
    await expect(page.getByTestId('forensics-reverify-btn')).toBeEnabled({ timeout: 5000 })

    // Seed a legacy HTML capture (no mhtml part).
    await page.evaluate(
      async ({ caseId, token }) => {
        const form = new FormData()
        form.append('source', 'manual')
        form.append('caseId', caseId)
        form.append('url', 'https://example.com/forensics-html')
        form.append('title', 'Legacy HTML')
        form.append('timestamp', new Date().toISOString())
        form.append('textContent', 'legacy body')
        form.append(
          'html',
          new Blob(['<html><body>legacy</body></html>'], { type: 'text/html' }),
          'capture.html'
        )
        const r = await fetch('http://127.0.0.1:19845/api/captures', {
          method: 'POST',
          body: form,
          headers: { 'X-Birdbrain-Token': token }
        })
        return r.json()
      },
      { caseId, token: serverToken }
    )

    // Pick the legacy capture (the second item in the list).
    const items = page.getByTestId('capture-item')
    await expect(items).toHaveCount(2)
    await items.nth(0).click() // most recent first; if order differs the legacy is nth(0)
    // Try to find the legacy item by title.
    const legacy = page.getByTestId('capture-item').filter({ hasText: 'Legacy HTML' })
    await legacy.click()

    await page.getByRole('button', { name: /forensics/i }).click()
    await expect(page.getByTestId('forensics-legacy-banner')).toBeVisible()
    await expect(page.getByText(/^Hash chain$/i)).toHaveCount(0)
    await expect(page.getByText(/^Identity$/i)).toBeVisible()
  })
})
```

- [ ] **Step 2: Build + run e2e.**

```bash
pnpm test:e2e -g "Forensics tab"
```

Expected: PASS. If the capture list ordering surprises the spec, fall back to filtering by capture title (`capture-item` filter pattern) for both clicks.

- [ ] **Step 3: Commit.**

```bash
git add e2e/forensics-tab.spec.ts
git commit -m "test(e2e): forensics tab covers mhtml chain + legacy banner"
```

---

### Task 6: Lint + typecheck + full test pass + dev smoke

- [ ] **Step 1: Run gates.**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```

All green.

- [ ] **Step 2: `pnpm dev` smoke.** Open a case with at least one MHTML capture, switch to Forensics, verify all sections render and Re-verify pulses both shields. If a legacy `format='html'` capture exists, switch and confirm the banner shows + chain section is hidden.

- [ ] **Step 3: Final commit if smoke turns up small UI tweaks (otherwise skip).**

---

### Task 7: Push branch + open PR

- [ ] **Step 1: Push.**

```bash
git push -u origin feat/capture-detail-pr1b
```

- [ ] **Step 2: Open PR via gh.**

Title: `feat(captures): rebuild Forensics tab (PR1b)`

Body summarizes: Metadata→Forensics rename, ShieldCheck icon, legacy HTML banner, six forensic sections (hash chain, identity, capture environment, operator, headers), shared `useVerifyMutation` with the panel, new `forensics-tab.spec.ts` e2e coverage. Reference design doc `docs/plans/capture-detail-redesign.md` §8.

---

## Self-Review Checklist

- [x] §8 sections covered: legacy banner, hash chain (mhtml), identity, capture environment (mhtml), operator (mhtml), headers (collapsible).
- [x] Empty rows hide via `Row` guard; empty operator section hides entirely.
- [x] Re-verify shares `useVerifyMutation` (same `mutationKey: ['verify-capture', captureId]` so panel + tab pulse together).
- [x] Tab rename (`metadata` → `forensics`) + icon swap (`Info` → `ShieldCheck`).
- [x] e2e covers both mhtml (chain visible) and html (banner visible).
- [x] No new dependencies, no schema changes.
- [x] Status colors stay raw (amber/red/emerald) per `theme.md`.
