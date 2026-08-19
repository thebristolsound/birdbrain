/**
 * Layout invariant over the report stylesheet.
 *
 * #633: the "Independent verification instructions" list was styled
 * `display: grid` with a 20pt counter column, but its items carry inline
 * `<strong>` and `<code>`. Every in-flow child of a grid container becomes a
 * grid item — including each inline element, with the text runs between them
 * wrapped in separate anonymous items. The prose was therefore dealt out
 * across the counter column one fragment at a time and wrapped one word per
 * line. It shipped in beta.20 because nothing checked how the document lays
 * out, only what it says.
 *
 * A grid container is safe only when its direct children are all elements —
 * then each grid item is exactly what the author intended. That is a property
 * of the markup, not of the CSS, so it cannot be asserted from the stylesheet
 * alone and there is no DOM in this test project to resolve it against.
 *
 * So this is a closed set, the same technique `reportCitationInvariants.ts`
 * uses for companion files: every selector allowed to declare `display: grid`
 * is listed here with the markup that justifies it. Adding a grid rule fails
 * this test until its author states which markup it lays out and confirms that
 * markup has no loose text. That is the review question the defect skipped.
 */
import { describe, it, expect } from 'vitest'
import { REPORT_PAGE_CSS } from '@main/services/reportHtml'

/**
 * Selector -> the markup it lays out, and why its children are element-only.
 * Verified by reading each construction site in reportHtml.ts.
 */
const APPROVED_GRID_SELECTORS: Record<string, string> = {
  '.field-grid': 'children are .field divs',
  '.scope-row': 'children are exactly one <dt> and one <dd>',
  '.legend-row': 'children are exactly two <span>s (legendRow())',
  '.plate-grid': 'children are <aside class="rail"> and the exhibit body',
  '.sig-grid': 'children are .sig-line divs'
}

/** Rules that declare `display: grid`, including inside @media blocks. */
function gridSelectors(css: string): string[] {
  // Comments first: they sit above rules and contain commas, so leaving them in
  // glues prose onto the selector it documents.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const found = new Set<string>()
  const rule = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = rule.exec(stripped)) !== null) {
    const [, selectorList, body] = match
    if (!/display\s*:\s*grid/.test(body)) continue
    for (const selector of selectorList.split(',')) {
      const trimmed = selector.trim()
      if (trimmed && !trimmed.startsWith('@')) found.add(trimmed)
    }
  }
  return [...found].sort()
}

describe('report layout invariants', () => {
  const css = REPORT_PAGE_CSS

  it('declares grid only on selectors whose markup has element-only children', () => {
    expect(gridSelectors(css)).toEqual(Object.keys(APPROVED_GRID_SELECTORS).sort())
  })

  it('does not lay the verification steps out as a grid', () => {
    // The steps carry inline <strong> and <code>; a grid shatters them (#633).
    expect(gridSelectors(css)).not.toContain('.steps > li')
  })

  it('indents the step counter without making the item a container', () => {
    expect(css).toMatch(/\.steps > li \{[^}]*position:\s*relative/)
    expect(css).toMatch(/\.steps > li::before \{[^}]*position:\s*absolute/)
  })

  it('recognises a grid rule that is not on the approved list', () => {
    const regressed = `${css}\n.steps > li { display: grid; grid-template-columns: 20pt 1fr; }`
    expect(gridSelectors(regressed)).toContain('.steps > li')
  })
})
