# PR #39 Review Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address all 5 Copilot review comments on PR #39 (feat: Create Selector from Selection in Chrome extension)

**Architecture:** All changes are in the `POST /api/selectors` endpoint in `captureServer.ts` and its tests. We add validation guards (archived case, active case match, label sanitization), refactor retroactive matching to use chunked processing, and fix a flaky test.

**Tech Stack:** TypeScript, Hono, Vitest, better-sqlite3

**Branch:** `feat/selector-from-highlight-v2` (already checked out)

---

### Task 1: Add archived case rejection

Mirrors the pattern used by `source=manual` and `source=selector` capture endpoints at lines 274 and 289.

**Files:**
- Modify: `src/main/services/captureServer.ts` (the `POST /api/selectors` handler)
- Modify: `tests/main/services/captureServer.test.ts`

- [ ] **Step 1: Write the failing test**

Add after the existing `'POST /api/selectors returns 404 for unknown case'` test:

```typescript
  it('POST /api/selectors returns 400 for archived case', async () => {
    const testCase = createCase({ name: 'Archived Selector' })
    updateCase({ id: testCase.id, archived: true })
    await activateSessionForCase(testCase.id)

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: 'test pattern'
      })
    })

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('archived')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/main/services/captureServer.test.ts -t "archived case"`
Expected: FAIL — currently returns 200

- [ ] **Step 3: Add archived check to the endpoint**

In `src/main/services/captureServer.ts`, in the `POST /api/selectors` handler, add this block immediately after the `if (!caseData)` check (after `return c.json({ error: 'Case not found' }, 404)`):

```typescript
      if (caseData.archived) {
        return c.json({ error: 'Case is archived' }, 400)
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/main/services/captureServer.test.ts -t "archived case"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/captureServer.ts tests/main/services/captureServer.test.ts
git commit -m "fix: reject archived cases in POST /api/selectors"
```

---

### Task 2: Enforce caseId matches active case

The endpoint requires an active session but doesn't verify the selector targets the active case. Add a guard that returns 400 if caseId !== state.activeCaseId.

**Files:**
- Modify: `src/main/services/captureServer.ts`
- Modify: `tests/main/services/captureServer.test.ts`

- [ ] **Step 1: Write the failing test**

Add after the archived case test:

```typescript
  it('POST /api/selectors returns 400 when caseId does not match active case', async () => {
    const activeCase = createCase({ name: 'Active Case Mismatch' })
    const otherCase = createCase({ name: 'Other Case' })
    await activateSessionForCase(activeCase.id)

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: otherCase.id,
        pattern: 'test pattern'
      })
    })

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('active case')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/main/services/captureServer.test.ts -t "does not match active case"`
Expected: FAIL — currently returns 200

- [ ] **Step 3: Add active case check to the endpoint**

In `src/main/services/captureServer.ts`, in the `POST /api/selectors` handler, add this block immediately after the `if (!caseId)` check:

```typescript
      if (caseId !== state.activeCaseId) {
        return c.json({ error: 'caseId does not match active case' }, 400)
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/main/services/captureServer.test.ts -t "does not match active case"`
Expected: PASS

- [ ] **Step 5: Run all selector tests to check no regressions**

Run: `pnpm test -- tests/main/services/captureServer.test.ts -t "POST /api/selectors"`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/services/captureServer.ts tests/main/services/captureServer.test.ts
git commit -m "fix: enforce caseId matches active case in POST /api/selectors"
```

---

### Task 3: Validate label field

The `label` field is accepted without type or emptiness validation. Sanitize it: if present and a non-empty string, trim it; otherwise treat as undefined.

**Files:**
- Modify: `src/main/services/captureServer.ts`
- Modify: `tests/main/services/captureServer.test.ts`

- [ ] **Step 1: Write failing tests**

Add after the active case mismatch test:

```typescript
  it('POST /api/selectors ignores non-string label', async () => {
    const testCase = createCase({ name: 'Bad Label Type' })
    await activateSessionForCase(testCase.id)

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: 'test',
        label: 12345
      })
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.selector.label).toBeUndefined()
  })

  it('POST /api/selectors trims whitespace-only label to undefined', async () => {
    const testCase = createCase({ name: 'Whitespace Label' })
    await activateSessionForCase(testCase.id)

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: 'test',
        label: '   '
      })
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.selector.label).toBeUndefined()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/main/services/captureServer.test.ts -t "label"`
Expected: At least one FAIL (non-string label may cause a 500 or pass an invalid value through)

- [ ] **Step 3: Update label handling in the endpoint**

In `src/main/services/captureServer.ts`, in the `POST /api/selectors` handler, replace this line:

```typescript
        label: label || undefined
```

with:

```typescript
        label: typeof label === 'string' && label.trim() !== '' ? label.trim() : undefined
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/main/services/captureServer.test.ts -t "label"`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/captureServer.ts tests/main/services/captureServer.test.ts
git commit -m "fix: validate and sanitize label in POST /api/selectors"
```

---

### Task 4: Chunked retroactive matching

Replace the single-pass retroactive matching with chunked processing that yields to the event loop between chunks. Cap at 500 most-recent captures.

**Files:**
- Modify: `src/main/services/captureServer.ts`

- [ ] **Step 1: Replace the retroactive matching block**

In `src/main/services/captureServer.ts`, in the `POST /api/selectors` handler, replace the entire `setImmediate(() => { ... })` block:

```typescript
      // Schedule retroactive matching asynchronously
      setImmediate(() => {
        try {
          const captures = db.listCaptures(caseId)
          const captureTexts: Array<{ captureId: string; text: string }> = []
          for (const cap of captures) {
            const buffer = readCaptureFile(caseId, cap.id, 'txt')
            if (buffer) {
              captureTexts.push({ captureId: cap.id, text: buffer.toString('utf-8') })
            }
          }
          if (captureTexts.length > 0) {
            db.matchSelectorAgainstCaptures(selector.id, captureTexts)
          }
        } catch (err) {
          console.error('Retroactive selector matching error:', err)
        }
      })
```

with:

```typescript
      // Schedule retroactive matching in chunks to avoid blocking the main thread
      setImmediate(() => {
        try {
          const MAX_RETRO_CAPTURES = 500
          const CHUNK_SIZE = 50
          const allCaptures = db.listCaptures(caseId)
          const startIndex = allCaptures.length > MAX_RETRO_CAPTURES
            ? allCaptures.length - MAX_RETRO_CAPTURES
            : 0
          const captures = allCaptures.slice(startIndex)

          const processChunk = (index: number) => {
            const end = Math.min(index + CHUNK_SIZE, captures.length)
            const captureTexts: Array<{ captureId: string; text: string }> = []

            for (let i = index; i < end; i++) {
              const cap = captures[i]
              const buffer = readCaptureFile(caseId, cap.id, 'txt')
              if (buffer) {
                captureTexts.push({ captureId: cap.id, text: buffer.toString('utf-8') })
              }
            }

            if (captureTexts.length > 0) {
              db.matchSelectorAgainstCaptures(selector.id, captureTexts)
            }

            if (end < captures.length) {
              setImmediate(() => processChunk(end))
            }
          }

          if (captures.length > 0) {
            processChunk(0)
          }
        } catch (err) {
          console.error('Retroactive selector matching error:', err)
        }
      })
```

- [ ] **Step 2: Run existing retroactive matching test**

Run: `pnpm test -- tests/main/services/captureServer.test.ts -t "retroactive"`
Expected: PASS (the test still works with chunked processing; we fix the timing in Task 5)

- [ ] **Step 3: Commit**

```bash
git add src/main/services/captureServer.ts
git commit -m "perf: chunk retroactive selector matching to avoid blocking main thread"
```

---

### Task 5: Fix flaky test timing

Replace the fixed 50ms `setTimeout` wait with a polling loop that has a 2-second timeout.

**Files:**
- Modify: `tests/main/services/captureServer.test.ts`

- [ ] **Step 1: Update the retroactive matching test**

In the `'POST /api/selectors schedules retroactive matching'` test, replace:

```typescript
    // Wait for setImmediate to complete retroactive matching
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Check that the selector matched the first capture
    const matchCounts = getSelectorMatchCounts(testCase.id)
```

with:

```typescript
    // Poll for retroactive matching to complete (chunked processing may need multiple ticks)
    let matchCounts = getSelectorMatchCounts(testCase.id)
    const deadline = Date.now() + 2000
    while (matchCounts[data.selector.id] !== 1 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      matchCounts = getSelectorMatchCounts(testCase.id)
    }
```

- [ ] **Step 2: Run the test**

Run: `pnpm test -- tests/main/services/captureServer.test.ts -t "retroactive"`
Expected: PASS

- [ ] **Step 3: Run full test suite to confirm no regressions**

Run: `pnpm test -- tests/main/services/captureServer.test.ts`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add tests/main/services/captureServer.test.ts
git commit -m "test: replace fixed wait with polling in retroactive matching test"
```
