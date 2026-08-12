// @vitest-environment jsdom
//
// Known-answer test for capture hygiene (#379): after PREPARE_FOR_CAPTURE the
// serialisable DOM must be identical to the page before any Birdbrain UI was
// injected — this is the DOM that pageCapture.saveAsMHTML archives and that the
// screenshot passes render.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { showToast, updateToast } from '../../extension/src/toast'
import type { ActiveCaseSelectors } from '@shared/types'
import type { SelectorMatchInfo } from '@shared/schemas'

type SendResponse = (response?: unknown) => void
type Listener = (message: unknown, sender: unknown, sendResponse: SendResponse) => unknown

const listeners: Listener[] = []

function dispatch(message: unknown): unknown[] {
  const responses: unknown[] = []
  for (const listener of listeners) {
    listener(message, {}, (r) => responses.push(r))
  }
  return responses
}

const PAGE_HTML =
  '<main><p>Report abuse to evil@example.com immediately.</p><p>Unrelated text.</p></main>'

const SELECTOR_GROUPS: ActiveCaseSelectors[] = [
  {
    caseId: 'case-1',
    caseName: 'Case One',
    selectors: [
      {
        id: 'sel-1',
        caseId: 'case-1',
        pattern: 'evil@example.com',
        isRegex: false,
        enabled: true,
        createdAt: '2026-08-11T00:00:00.000Z'
      }
    ]
  }
]

function setPageHtml(html: string): void {
  document.head.innerHTML = ''
  document.body.innerHTML = html
  // CHECK_SELECTORS reads body.innerText, which jsdom does not implement —
  // back it with textContent so the real matching path runs
  Object.defineProperty(document.body, 'innerText', {
    configurable: true,
    get: () => document.body.textContent ?? ''
  })
}

beforeAll(async () => {
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
      sendMessage: vi.fn()
    }
  })
  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    vi.stubGlobal('requestAnimationFrame', () => 0)
  }
  // Side-effecting import: registers the content script's onMessage listener
  await import('../../extension/src/content')
})

describe('PREPARE_FOR_CAPTURE (#379)', () => {
  it('strips toast and highlights so the serialised DOM matches the pre-injection page', () => {
    setPageHtml(PAGE_HTML)
    const baseline = document.documentElement.outerHTML

    // Inject real highlights through the live CHECK_SELECTORS path
    const [matches] = dispatch({ type: 'CHECK_SELECTORS', selectors: SELECTOR_GROUPS }) as [
      SelectorMatchInfo[]
    ]
    expect(matches.length).toBeGreaterThan(0)
    expect(document.querySelectorAll('mark.birdbrain-selector-highlight').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('style[data-birdbrain-highlight]').length).toBeGreaterThan(0)

    // Inject the real capture toast
    showToast({ status: 'capturing' })
    expect(document.getElementById('birdbrain-capture-toast')).not.toBeNull()

    const responses = dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    expect(responses).toContainEqual({ ok: true })

    expect(document.getElementById('birdbrain-capture-toast')).toBeNull()
    expect(document.querySelectorAll('mark.birdbrain-selector-highlight').length).toBe(0)
    expect(document.querySelectorAll('style[data-birdbrain-highlight]').length).toBe(0)
    // The randomized style container host carries a birdbrain- id prefix
    expect(document.querySelectorAll('[id^="birdbrain-"]').length).toBe(0)
    // Known answer: what saveAsMHTML would serialise is the original page
    expect(document.documentElement.outerHTML).toBe(baseline)
  })

  it('removes a toast that is mid-dismissal without waiting for its timer', () => {
    setPageHtml(PAGE_HTML)
    updateToast({ status: 'success' })
    expect(document.getElementById('birdbrain-capture-toast')).not.toBeNull()

    dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    expect(document.getElementById('birdbrain-capture-toast')).toBeNull()
  })

  it('responds ok and leaves the DOM untouched when nothing was injected', () => {
    setPageHtml(PAGE_HTML)
    const baseline = document.documentElement.outerHTML

    const responses = dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    expect(responses).toContainEqual({ ok: true })
    expect(document.documentElement.outerHTML).toBe(baseline)
  })
})
