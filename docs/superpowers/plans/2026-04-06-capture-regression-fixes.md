# Capture Regression Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore three features that regressed during the MHTML migration: screenshot capture, text content file storage, and selector highlighting after manual capture.

**Architecture:** Minimal changes across 4 files. Screenshots re-added to the extension capture flow and sent alongside MHTML via FormData. Text content written to `.txt` files during server-side ingest. Selector highlighting triggered after manual captures complete.

**Tech Stack:** Chrome Extension APIs (`chrome.tabs.captureVisibleTab`, `chrome.pageCapture`), Hono server, Node.js `fs`, Vitest

---

### Task 1: Write text content to disk during MHTML ingest

**Files:**
- Modify: `src/main/services/mhtmlIngest.ts:1-6` (add `writeFileSync` import)
- Modify: `src/main/services/mhtmlIngest.ts:118-165` (write `.txt` file in `ingestMhtmlCapture`)
- Test: `tests/main/services/mhtmlIngest.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to the `ingestMhtmlCapture` describe block in `tests/main/services/mhtmlIngest.test.ts` after the existing "ingests an MHTML capture" test (line 124):

```typescript
  it('writes textContent to .txt file alongside MHTML', async () => {
    const content = Buffer.from('mhtml payload')
    const stream = Readable.from([content])
    const result = await ingestMhtmlCapture({
      caseId,
      url: 'https://example.com/text',
      title: 'Text Test',
      timestamp: '2026-04-06T12:00:00.000Z',
      stream: stream as unknown as ReadableStream<Uint8Array>,
      textContent: 'Hello world extracted text',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0'
    })

    const txtPath = join(tempDir, 'captures', caseId, `${result.capture.id}.txt`)
    expect(existsSync(txtPath)).toBe(true)
    expect(readFileSync(txtPath, 'utf-8')).toBe('Hello world extracted text')
  })

  it('does not write .txt file when textContent is empty', async () => {
    const content = Buffer.from('mhtml payload')
    const stream = Readable.from([content])
    const result = await ingestMhtmlCapture({
      caseId,
      url: 'https://example.com/empty',
      title: 'Empty Text',
      timestamp: '2026-04-06T12:00:00.000Z',
      stream: stream as unknown as ReadableStream<Uint8Array>,
      textContent: '',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0'
    })

    const txtPath = join(tempDir, 'captures', caseId, `${result.capture.id}.txt`)
    expect(existsSync(txtPath)).toBe(false)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/main/services/mhtmlIngest.test.ts`
Expected: Both new tests FAIL because no `.txt` file is written.

- [ ] **Step 3: Implement text file writing**

In `src/main/services/mhtmlIngest.ts`, add `writeFileSync` to the existing `fs` import on line 1:

```typescript
import { createWriteStream, createReadStream, writeFileSync, type WriteStream } from 'fs'
```

In the `ingestMhtmlCapture` function, add text file writing after the `streamWriteAndHash` call (after line 124) and before the manifest entry (line 126):

```typescript
  const { mhtmlPath, hash, sizeBytes } = await streamWriteAndHash(
    params.caseId,
    captureId,
    params.stream
  )

  // Write plain text content to disk for the viewer's Text tab
  if (params.textContent) {
    writeFileSync(join(getStorageRoot(), params.caseId, `${captureId}.txt`), params.textContent, 'utf-8')
  }

  const caseDir = join(getStorageRoot(), params.caseId)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/main/services/mhtmlIngest.test.ts`
Expected: All tests PASS including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/mhtmlIngest.ts tests/main/services/mhtmlIngest.test.ts
git commit -m "fix: write textContent to .txt file during MHTML ingest"
```

---

### Task 2: Add screenshot to MHTML ingest pipeline

**Files:**
- Modify: `src/main/services/mhtmlIngest.ts:91-106` (add `screenshot` to `IngestParams`)
- Modify: `src/main/services/mhtmlIngest.ts:118-165` (write `.png` and pass `screenshotPath` to DB)
- Test: `tests/main/services/mhtmlIngest.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to the `ingestMhtmlCapture` describe block in `tests/main/services/mhtmlIngest.test.ts`:

```typescript
  it('writes screenshot to .png file and stores screenshotPath in DB', async () => {
    const content = Buffer.from('mhtml payload')
    const stream = Readable.from([content])
    const screenshotData = Buffer.from('fake-png-data')
    const result = await ingestMhtmlCapture({
      caseId,
      url: 'https://example.com/screenshot',
      title: 'Screenshot Test',
      timestamp: '2026-04-06T12:00:00.000Z',
      stream: stream as unknown as ReadableStream<Uint8Array>,
      textContent: '',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0',
      screenshot: screenshotData
    })

    const pngPath = join(tempDir, 'captures', caseId, `${result.capture.id}.png`)
    expect(existsSync(pngPath)).toBe(true)
    expect(readFileSync(pngPath).equals(screenshotData)).toBe(true)

    const reloaded = getCapture(result.capture.id)
    expect(reloaded?.screenshotPath).toBe(join(caseId, `${result.capture.id}.png`))
  })

  it('does not write .png file when screenshot is not provided', async () => {
    const content = Buffer.from('mhtml payload')
    const stream = Readable.from([content])
    const result = await ingestMhtmlCapture({
      caseId,
      url: 'https://example.com/no-screenshot',
      title: 'No Screenshot',
      timestamp: '2026-04-06T12:00:00.000Z',
      stream: stream as unknown as ReadableStream<Uint8Array>,
      textContent: '',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0'
    })

    const pngPath = join(tempDir, 'captures', caseId, `${result.capture.id}.png`)
    expect(existsSync(pngPath)).toBe(false)

    const reloaded = getCapture(result.capture.id)
    expect(reloaded?.screenshotPath).toBeUndefined()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/main/services/mhtmlIngest.test.ts`
Expected: FAIL — `screenshot` property doesn't exist on `IngestParams`, and no `.png` is written.

- [ ] **Step 3: Implement screenshot storage in ingest pipeline**

In `src/main/services/mhtmlIngest.ts`, add `screenshot` to the `IngestParams` interface (after line 105):

```typescript
export interface IngestParams {
  caseId: string
  url: string
  title: string
  timestamp: string
  stream: ReadableStream<Uint8Array>
  textContent: string
  headers: Record<string, string>
  browserVersion: string
  userAgent: string
  httpStatus: number
  extensionVersion: string
  operatorId: string
  operatorName: string
  toolVersion: string
  screenshot?: Buffer
}
```

In the `ingestMhtmlCapture` function, add screenshot writing after the text content write (and before the manifest), and pass `screenshotPath` to `db.insertCapture`:

```typescript
  // Write screenshot to disk
  let screenshotPath: string | undefined
  if (params.screenshot) {
    screenshotPath = join(params.caseId, `${captureId}.png`)
    writeFileSync(join(getStorageRoot(), screenshotPath), params.screenshot)
  }
```

Then in the `db.insertCapture` call (around line 142), add:

```typescript
      screenshotPath,
```

after the `htmlPath` line (which is currently omitted, so add it alongside the other fields). The full call becomes:

```typescript
    const capture = db.insertCapture({
      id: captureId,
      caseId: params.caseId,
      url: params.url,
      title: params.title,
      hash,
      timestamp: params.timestamp,
      headers: JSON.stringify(params.headers),
      textContent: params.textContent,
      screenshotPath,
      format: 'mhtml',
      mhtmlPath,
      sizeBytes,
      manifestIndex: manifestResult.index,
      prevHash: manifestResult.prevHash,
      entryHash: manifestResult.entryHash,
      toolVersion: params.toolVersion,
      extensionVersion: params.extensionVersion,
      browserVersion: params.browserVersion,
      userAgent: params.userAgent,
      httpStatus: params.httpStatus,
      operatorId: params.operatorId,
      operatorName: params.operatorName
    })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/main/services/mhtmlIngest.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/mhtmlIngest.ts tests/main/services/mhtmlIngest.test.ts
git commit -m "feat: store screenshots alongside MHTML captures in ingest pipeline"
```

---

### Task 3: Accept screenshot in capture server endpoint

**Files:**
- Modify: `src/main/services/captureServer.ts:212-312` (extract screenshot from FormData, pass to ingest)
- Test: `tests/main/services/captureServer.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `tests/main/services/captureServer.test.ts` after the existing "stores a manual MHTML capture with forensic fields" test (around line 668):

```typescript
  it('stores screenshot alongside MHTML capture', async () => {
    const c = createCase({ name: 'Screenshot Test' })
    const screenshotData = Buffer.from('fake-png-screenshot-data')

    const form = new FormData()
    form.append('source', 'manual')
    form.append('caseId', c.id)
    form.append('url', 'https://example.com/with-screenshot')
    form.append('title', 'Screenshot Page')
    form.append('timestamp', new Date().toISOString())
    form.append('textContent', 'page text')
    form.append('mhtml', new Blob(['<html>ss</html>'], { type: 'multipart/related' }), 'capture.mhtml')
    form.append('screenshot', new Blob([screenshotData], { type: 'image/png' }), 'screenshot.png')

    const res = await fetch(`${baseUrl}/api/captures`, { method: 'POST', body: form })
    expect(res.status).toBe(200)
    const data = await res.json()

    const captures = listCaptures(c.id)
    expect(captures).toHaveLength(1)
    expect(captures[0].screenshotPath).toContain('.png')
  })
```

Also add an import for `readFileSync` and `existsSync` at the top of the test file if not already present. Check and add:

```typescript
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/main/services/captureServer.test.ts -t "stores screenshot alongside MHTML"`
Expected: FAIL — `screenshotPath` is undefined because the server doesn't extract/pass the screenshot.

- [ ] **Step 3: Implement screenshot extraction in capture endpoint**

In `src/main/services/captureServer.ts`, in the `POST /api/captures` handler, add screenshot extraction after the `mhtmlField` validation (after line 247):

```typescript
      const screenshotField = body['screenshot']
      let screenshotBuffer: Buffer | undefined
      if (screenshotField instanceof File || screenshotField instanceof Blob) {
        screenshotBuffer = Buffer.from(await screenshotField.arrayBuffer())
      }
```

Then pass it to `ingestMhtmlCapture` by adding `screenshot: screenshotBuffer` to the params object (around line 311):

```typescript
      const { capture, contentHash } = await ingestMhtmlCapture({
        caseId,
        url,
        title,
        timestamp,
        stream: mhtmlField.stream(),
        textContent,
        headers: {},
        browserVersion,
        userAgent,
        httpStatus,
        extensionVersion,
        operatorId,
        operatorName,
        toolVersion,
        screenshot: screenshotBuffer
      })
```

- [ ] **Step 4: Run all capture server tests to verify they pass**

Run: `pnpm test -- tests/main/services/captureServer.test.ts`
Expected: All tests PASS including the new screenshot test.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/captureServer.ts tests/main/services/captureServer.test.ts
git commit -m "feat: extract screenshot from FormData and pass to ingest pipeline"
```

---

### Task 4: Add screenshot param to extension API client

**Files:**
- Modify: `extension/src/utils/api.ts:106-148` (add `screenshot` to `sendMhtmlCapture`)

- [ ] **Step 1: Add screenshot parameter**

In `extension/src/utils/api.ts`, add `screenshot?: Blob` to the `sendMhtmlCapture` params type (after line 118, after `matchedSelectors`):

```typescript
export async function sendMhtmlCapture(params: {
  source: 'auto' | 'manual' | 'selector'
  caseId?: string
  url: string
  title: string
  timestamp: string
  textContent: string
  mhtml: Blob
  screenshot?: Blob
  browserVersion: string
  userAgent: string
  extensionVersion: string
  httpStatus?: number
  matchedSelectors?: SelectorMatchInfo[]
}): Promise<CaptureResult> {
```

Add the FormData append for screenshot after the `matchedSelectors` append (after line 133) and before the `mhtml` append:

```typescript
  if (params.screenshot) {
    form.append('screenshot', params.screenshot, 'screenshot.png')
  }
```

- [ ] **Step 2: Build extension to verify no type errors**

Run: `pnpm build:extension`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add extension/src/utils/api.ts
git commit -m "feat: add screenshot param to sendMhtmlCapture API client"
```

---

### Task 5: Capture screenshots in background script

**Files:**
- Modify: `extension/src/background.ts:333-438` (add `captureVisibleTab` to all three capture functions)

- [ ] **Step 1: Add screenshot helper function**

Add this helper function after the `getPlainTextFromTab` function (after line 39):

```typescript
async function captureScreenshot(tabId: number): Promise<Blob | undefined> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' })
    const res = await fetch(dataUrl)
    return await res.blob()
  } catch {
    return undefined
  }
}
```

Note: `captureVisibleTab` captures the active tab in the current window. It does not take a `tabId` param — it captures whatever is visible. The screenshot is best-effort (returns `undefined` on failure).

- [ ] **Step 2: Add screenshot to `captureTab` (auto-capture)**

In `captureTab()` (line 333), add `captureScreenshot` to the `Promise.all` and pass the result to `sendMhtmlCapture`:

```typescript
async function captureTab(tabId: number, url: string): Promise<void> {
  try {
    const [mhtmlBlob, tab, textContent, screenshot] = await Promise.all([
      captureMhtml(tabId),
      chrome.tabs.get(tabId),
      getPlainTextFromTab(tabId),
      captureScreenshot()
    ])

    await sendMhtmlCapture({
      source: 'auto',
      url,
      title: tab.title || url,
      timestamp: new Date().toISOString(),
      textContent,
      mhtml: mhtmlBlob,
      screenshot,
      browserVersion: getBrowserVersion(),
      userAgent: getUserAgentString(),
      extensionVersion: getExtensionVersion(),
      httpStatus: 200
    })

    dedupeMap.set(url, Date.now())
    captureCount++
    chrome.action.setBadgeText({ text: String(captureCount) })
  } catch (err) {
    console.error('Capture failed:', err)
  }
}
```

- [ ] **Step 3: Add screenshot to `manualCaptureTab`**

In `manualCaptureTab()` (line 362), add `captureScreenshot` to the `Promise.all` and pass to `sendMhtmlCapture`:

```typescript
    const [mhtmlBlob, tab, textContent, screenshot] = await Promise.all([
      captureMhtml(tabId),
      chrome.tabs.get(tabId),
      getPlainTextFromTab(tabId),
      captureScreenshot(tabId)
    ])

    await sendMhtmlCapture({
      source: 'manual',
      caseId,
      url,
      title: tab.title || url,
      timestamp: new Date().toISOString(),
      textContent,
      mhtml: mhtmlBlob,
      screenshot,
      browserVersion: getBrowserVersion(),
      userAgent: getUserAgentString(),
      extensionVersion: getExtensionVersion(),
      httpStatus: 200
    })
```

- [ ] **Step 4: Add screenshot to `handleSelectorCapture`**

In `handleSelectorCapture()` (line 412), add `captureScreenshot` to the `Promise.all` and pass to `sendMhtmlCapture`:

```typescript
    const [mhtmlBlob, tab, textContent, screenshot] = await Promise.all([
      captureMhtml(tabId),
      chrome.tabs.get(tabId),
      getPlainTextFromTab(tabId),
      captureScreenshot(tabId)
    ])
    await sendMhtmlCapture({
      source: 'selector',
      caseId,
      url,
      title: tab.title || url,
      timestamp: new Date().toISOString(),
      textContent,
      mhtml: mhtmlBlob,
      screenshot,
      browserVersion: getBrowserVersion(),
      userAgent: getUserAgentString(),
      extensionVersion: getExtensionVersion(),
      httpStatus: 200,
      matchedSelectors: []
    })
```

- [ ] **Step 5: Build extension to verify no errors**

Run: `pnpm build:extension`
Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add extension/src/background.ts
git commit -m "feat: re-add screenshot capture to auto, manual, and selector capture flows"
```

---

### Task 6: Trigger selector highlighting after manual capture

**Files:**
- Modify: `extension/src/background.ts:362-409` (call `checkSelectorsOnTab` after success toast)

- [ ] **Step 1: Add checkSelectorsOnTab call after manual capture success**

In `manualCaptureTab()`, after the success toast message (line 390-391), add a call to `checkSelectorsOnTab`:

```typescript
    chrome.tabs
      .sendMessage(tabId, { type: 'UPDATE_CAPTURE_TOAST', status: 'success' })
      .catch(() => {})

    // Re-evaluate selector highlights after capture
    if (activeSelectors.length > 0) {
      checkSelectorsOnTab(tabId, url)
    }
```

- [ ] **Step 2: Build extension to verify no errors**

Run: `pnpm build:extension`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add extension/src/background.ts
git commit -m "fix: trigger selector highlighting after manual capture completes"
```

---

### Task 7: Run full test suite and build verification

**Files:** None (verification only)

- [ ] **Step 1: Run all unit tests**

Run: `pnpm test`
Expected: All tests PASS.

- [ ] **Step 2: Build the Electron app**

Run: `pnpm build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Build the extension**

Run: `pnpm build:extension`
Expected: Build succeeds, `extension/dist/` contains `background.js`, `content.js`, `popup.html`.

- [ ] **Step 4: Run linter**

Run: `pnpm lint`
Expected: No errors.
