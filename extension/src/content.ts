// Content script — runs on every page at document_idle
// Extracts page data when asked by the background script
// Handles selector matching and inline highlighting

import { showToast, updateToast } from './toast'

interface SelectorInfo {
  id: string
  caseId: string
  pattern: string
  isRegex: boolean
  enabled: boolean
  label?: string
}

interface ActiveCaseSelectors {
  caseId: string
  caseName: string
  selectors: SelectorInfo[]
}

interface SelectorMatchResult {
  selectorId: string
  caseId: string
  caseName: string
  pattern: string
  matchText: string
  context: string
  index: number
}

const HIGHLIGHT_CLASS = 'birdbrain-selector-highlight'

const HIGHLIGHT_STYLES = `
  .${HIGHLIGHT_CLASS} {
    background: rgba(251, 191, 36, 0.35) !important;
    border-bottom: 2px solid #f59e0b !important;
    padding: 1px 2px !important;
    border-radius: 2px !important;
  }
`

let stylesInjected = false

function injectHighlightStyles(): void {
  if (stylesInjected) return
  const style = document.createElement('style')
  style.textContent = HIGHLIGHT_STYLES
  style.id = 'birdbrain-highlight-styles'
  document.head.appendChild(style)
  stylesInjected = true
}

function removeHighlightStyles(): void {
  const style = document.getElementById('birdbrain-highlight-styles')
  if (style) style.remove()
  stylesInjected = false
}

function extractContext(text: string, index: number, matchLength: number): string {
  const contextRadius = 50
  const start = Math.max(0, index - contextRadius)
  const end = Math.min(text.length, index + matchLength + contextRadius)
  let context = ''
  if (start > 0) context += '...'
  context += text.slice(start, end)
  if (end < text.length) context += '...'
  return context
}

function matchSelectors(
  text: string,
  caseSelectorGroups: ActiveCaseSelectors[]
): SelectorMatchResult[] {
  const results: SelectorMatchResult[] = []

  for (const group of caseSelectorGroups) {
    for (const selector of group.selectors) {
      if (!selector.enabled) continue

      try {
        if (selector.isRegex) {
          const re = new RegExp(selector.pattern, 'gi')
          let match: RegExpExecArray | null
          while ((match = re.exec(text)) !== null) {
            results.push({
              selectorId: selector.id,
              caseId: group.caseId,
              caseName: group.caseName,
              pattern: selector.pattern,
              matchText: match[0],
              context: extractContext(text, match.index, match[0].length),
              index: match.index
            })
            // Prevent infinite loops on zero-length matches
            if (match[0].length === 0) re.lastIndex++
          }
        } else {
          const lowerText = text.toLowerCase()
          const lowerPattern = selector.pattern.toLowerCase()
          let pos = 0
          while ((pos = lowerText.indexOf(lowerPattern, pos)) !== -1) {
            const matchText = text.slice(pos, pos + selector.pattern.length)
            results.push({
              selectorId: selector.id,
              caseId: group.caseId,
              caseName: group.caseName,
              pattern: selector.pattern,
              matchText,
              context: extractContext(text, pos, selector.pattern.length),
              index: pos
            })
            pos += selector.pattern.length
          }
        }
      } catch {
        // Invalid regex — skip
      }
    }
  }

  return results
}

function highlightMatches(matches: SelectorMatchResult[]): void {
  if (matches.length === 0) return

  injectHighlightStyles()

  // Collect unique match strings with their metadata
  const matchStrings = new Map<string, SelectorMatchResult[]>()
  for (const m of matches) {
    const key = m.matchText.toLowerCase()
    if (!matchStrings.has(key)) matchStrings.set(key, [])
    matchStrings.get(key)!.push(m)
  }

  // Walk text nodes and wrap matches
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Skip script/style/our own elements
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      const tag = parent.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
        return NodeFilter.FILTER_REJECT
      }
      if (parent.classList.contains(HIGHLIGHT_CLASS)) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    }
  })

  const textNodes: Text[] = []
  let node: Node | null
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text)
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent || ''
    if (!text.trim()) continue

    const lowerText = text.toLowerCase()
    let hasMatch = false
    for (const key of matchStrings.keys()) {
      if (lowerText.includes(key)) {
        hasMatch = true
        break
      }
    }
    if (!hasMatch) continue

    // Build list of match ranges in this text node
    const ranges: Array<{ start: number; end: number; matchIndex: number }> = []
    for (const [key, matchList] of matchStrings) {
      let pos = 0
      while ((pos = lowerText.indexOf(key, pos)) !== -1) {
        ranges.push({
          start: pos,
          end: pos + key.length,
          matchIndex: matchList[0].index
        })
        pos += key.length
      }
    }

    if (ranges.length === 0) continue

    // Sort ranges and handle overlaps (keep first)
    ranges.sort((a, b) => a.start - b.start)
    const merged: typeof ranges = []
    for (const r of ranges) {
      if (merged.length === 0 || r.start >= merged[merged.length - 1].end) {
        merged.push(r)
      }
    }

    // Replace text node with highlighted fragments
    const fragment = document.createDocumentFragment()
    let lastEnd = 0

    for (const r of merged) {
      if (r.start > lastEnd) {
        fragment.appendChild(document.createTextNode(text.slice(lastEnd, r.start)))
      }
      const mark = document.createElement('mark')
      mark.className = HIGHLIGHT_CLASS
      mark.dataset.matchIndex = String(r.matchIndex)
      mark.textContent = text.slice(r.start, r.end)
      mark.style.cursor = 'pointer'
      mark.addEventListener('click', () => {})
      fragment.appendChild(mark)
      lastEnd = r.end
    }

    if (lastEnd < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastEnd)))
    }

    textNode.parentNode?.replaceChild(fragment, textNode)
  }
}

function removeHighlights(): void {
  const marks = document.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`)
  marks.forEach((mark) => {
    const parent = mark.parentNode
    if (parent) {
      const text = document.createTextNode(mark.textContent || '')
      parent.replaceChild(text, mark)
      parent.normalize()
    }
  })
  removeHighlightStyles()
}

let captureInProgress = false

type StickyEntry = { el: HTMLElement; origValue: string; origPriority: string }

const STICKY_FIXED_SELECTORS = [
  'header',
  'nav',
  'footer',
  '[role="banner"]',
  '[role="navigation"]',
  '[class~="sticky"]',
  '[class~="fixed"]',
  '[class*="navbar"]',
  '[class*="topbar"]',
  '[class*="top-bar"]',
  '[style*="position:fixed"]',
  '[style*="position: fixed"]',
  '[style*="position:sticky"]',
  '[style*="position: sticky"]'
].join(', ')

function collectStickyElements(): StickyEntry[] {
  const entries: StickyEntry[] = []
  document.querySelectorAll(STICKY_FIXED_SELECTORS).forEach((node) => {
    const el = node as HTMLElement
    const style = getComputedStyle(el)
    if (style.position === 'fixed' || style.position === 'sticky') {
      entries.push({
        el,
        origValue: el.style.getPropertyValue('position'),
        origPriority: el.style.getPropertyPriority('position')
      })
    }
  })
  return entries
}

function restoreStickyElements(entries: StickyEntry[]): void {
  for (const entry of entries) {
    if (entry.origValue) {
      entry.el.style.setProperty('position', entry.origValue, entry.origPriority)
    } else {
      entry.el.style.removeProperty('position')
    }
  }
}

const CAPTURE_MAX_BYTES = 100 * 1024 * 1024 // 100 MB raw bitmap budget
const SCROLL_TIMEOUT_MS = 120 * 1000 // 120 seconds for scroll phase
const SCROLL_PAUSE_MS = 500 // pause between scrolls for lazy-load
const SCROLL_STALL_THRESHOLD = 3 // stop if scrollHeight unchanged this many times

async function captureFullPage(maxBytes: number = CAPTURE_MAX_BYTES): Promise<string> {
  if (captureInProgress) {
    throw new Error('Capture already in progress')
  }
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas is not available in this context')
  }

  captureInProgress = true
  const savedScrollX = window.scrollX
  const savedScrollY = window.scrollY

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const dpr = window.devicePixelRatio || 1
  // Raw bytes per viewport slice: width * height * 4 (RGBA) * dpr^2
  const bytesPerSlice = viewportWidth * viewportHeight * 4 * dpr * dpr
  const totalHeight = document.documentElement.scrollHeight
  const maxSlices = Math.ceil(totalHeight / viewportHeight)

  // Collect sticky/fixed elements to hide during capture
  const stickyElements = collectStickyElements()

  const slices: Array<{ dataUrl: string; yOffset: number }> = []
  let accumulatedBytes = 0

  try {
    for (let i = 0; i < maxSlices; i++) {
      // Check byte budget before capturing this slice
      if (accumulatedBytes + bytesPerSlice > maxBytes && slices.length > 0) {
        console.log('[Birdbrain] Byte budget reached after', slices.length, 'slices')
        break
      }

      const yOffset = i * viewportHeight

      // Hide sticky elements after first slice (so headers appear at top)
      if (i === 1) {
        for (const entry of stickyElements) {
          entry.el.style.setProperty('position', 'relative', 'important')
        }
      }

      window.scrollTo(0, yOffset)
      await new Promise((r) => setTimeout(r, 150))

      try {
        const response = await chrome.runtime.sendMessage({ type: 'REQUEST_VIEWPORT_CAPTURE' })
        if (response?.dataUrl) {
          slices.push({ dataUrl: response.dataUrl, yOffset })
          accumulatedBytes += bytesPerSlice
        } else {
          console.warn('[Birdbrain] Viewport capture returned no data for slice', i)
        }
      } catch (err) {
        console.warn('[Birdbrain] Viewport capture failed for slice', i, err)
      }
    }

    // Stitch slices onto OffscreenCanvas
    const capturedHeight =
      slices.length > 0 ? slices[slices.length - 1].yOffset + viewportHeight : viewportHeight
    const clampedHeight = Math.min(capturedHeight, totalHeight)
    const bitmapTotalHeight = Math.round(clampedHeight * dpr)

    const canvas = new OffscreenCanvas(Math.round(viewportWidth * dpr), bitmapTotalHeight)
    const ctx = canvas.getContext('2d')!

    for (const slice of slices) {
      const img = await createImageBitmapFromDataUrl(slice.dataUrl)
      const destY = Math.round(slice.yOffset * dpr)
      const destH = Math.min(img.height, bitmapTotalHeight - destY)
      ctx.drawImage(img, 0, 0, img.width, img.height, 0, destY, img.width, destH)
      img.close()
    }

    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return await blobToDataUrl(blob)
  } finally {
    captureInProgress = false
    restoreStickyElements(stickyElements)
    window.scrollTo(savedScrollX, savedScrollY)
  }
}

async function createImageBitmapFromDataUrl(dataUrl: string): Promise<ImageBitmap> {
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  return createImageBitmap(blob)
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function captureFullPageScrolling(
  maxBytes: number = CAPTURE_MAX_BYTES,
  scrollTimeoutMs: number = SCROLL_TIMEOUT_MS
): Promise<string> {
  if (captureInProgress) {
    throw new Error('Capture already in progress')
  }

  captureInProgress = true
  const savedScrollX = window.scrollX
  const savedScrollY = window.scrollY
  const viewportHeight = window.innerHeight

  try {
    // Phase 1: Scroll to load content
    const startTime = Date.now()
    let stalls = 0
    let lastScrollHeight = document.documentElement.scrollHeight

    while (Date.now() - startTime < scrollTimeoutMs) {
      window.scrollBy(0, viewportHeight)
      await new Promise((r) => setTimeout(r, SCROLL_PAUSE_MS))

      const currentScrollHeight = document.documentElement.scrollHeight
      if (currentScrollHeight === lastScrollHeight) {
        stalls++
        if (stalls >= SCROLL_STALL_THRESHOLD) {
          console.log('[Birdbrain] Scroll stalled after', stalls, 'attempts — page end reached')
          break
        }
      } else {
        stalls = 0
        lastScrollHeight = currentScrollHeight
      }
    }

    if (Date.now() - startTime >= scrollTimeoutMs) {
      console.log('[Birdbrain] Scroll phase timed out after', scrollTimeoutMs / 1000, 'seconds')
    }

    // Phase 2: Scroll back to top and capture with byte budget
    window.scrollTo(0, 0)
    await new Promise((r) => setTimeout(r, 150))

    // Release the captureInProgress lock so captureFullPage can acquire it
    captureInProgress = false
    return await captureFullPage(maxBytes)
  } catch (err) {
    captureInProgress = false
    // Restore scroll position on error
    window.scrollTo(savedScrollX, savedScrollY)
    throw err
  }
}

// --- Message handlers ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CAPTURE_FULL_PAGE') {
    const maxBytes: number = message.maxBytes || CAPTURE_MAX_BYTES
    captureFullPage(maxBytes).then(
      (dataUrl) => sendResponse({ screenshot: dataUrl }),
      (err) => sendResponse({ error: String(err) })
    )
    return true // keep channel open for async response
  }

  if (message.type === 'CAPTURE_FULL_PAGE_SCROLLING') {
    const maxBytes: number = message.maxBytes || CAPTURE_MAX_BYTES
    const scrollTimeoutMs: number = message.scrollTimeoutMs || SCROLL_TIMEOUT_MS
    captureFullPageScrolling(maxBytes, scrollTimeoutMs).then(
      (dataUrl) => sendResponse({ screenshot: dataUrl }),
      (err) => sendResponse({ error: String(err) })
    )
    return true // keep channel open for async response
  }

  if (message.type === 'SHOW_CAPTURE_TOAST') {
    showToast({ status: 'capturing' })
    sendResponse({ ok: true })
    return
  }

  if (message.type === 'UPDATE_CAPTURE_TOAST') {
    updateToast({ status: message.status, message: message.message })
    sendResponse({ ok: true })
    return
  }

  if (message.type === 'CHECK_SELECTORS') {
    const selectors = message.selectors as ActiveCaseSelectors[]
    const text = document.body?.innerText || ''

    // Remove previous highlights
    removeHighlights()

    const matches = matchSelectors(text, selectors)

    if (matches.length > 0) {
      highlightMatches(matches)
    }

    sendResponse(matches)
  }

  if (message.type === 'CLEAR_HIGHLIGHTS') {
    removeHighlights()
    sendResponse({ ok: true })
  }

  return true // Keep channel open for async response
})
