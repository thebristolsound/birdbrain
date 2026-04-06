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

// --- Message handlers ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
