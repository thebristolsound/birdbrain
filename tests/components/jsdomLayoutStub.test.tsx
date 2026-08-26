// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'

// Guards tests/setup/jsdom/layout.ts. jsdom stubs Element's measurement API and
// not Range's, so ProseMirror's singleRect() throws instead of reading a zero
// box, and it throws as an unhandled error that fails the run with nothing
// reported red (#1013). Delete the setup file or drop it from vitest.config.ts
// and these fail, which is the point: the stub has no other caller to notice.
//
// The .tsx extension is load-bearing despite the absence of JSX: the jsdom
// project collects tests/components/**/*.test.tsx, so a rename to .test.ts
// would move this file to the node project, where Range is not defined and the
// setup file under test never runs.

describe('jsdom Range measurement stub', () => {
  const rangeOverText = () => {
    const p = document.createElement('p')
    p.textContent = 'nightjar'
    document.body.appendChild(p)
    const range = document.createRange()
    range.setStart(p.firstChild as Text, 0)
    range.setEnd(p.firstChild as Text, 8)
    return range
  }

  it('gives Range both members, which jsdom leaves undefined', () => {
    expect(typeof Range.prototype.getClientRects).toBe('function')
    expect(typeof Range.prototype.getBoundingClientRect).toBe('function')
  })

  it('reports an empty rect list rather than throwing', () => {
    const rects = rangeOverText().getClientRects()
    expect(rects.length).toBe(0)
  })

  it('reports a zero box, matching what jsdom gives an element', () => {
    const box = rangeOverText().getBoundingClientRect()
    expect(box.top).toBe(0)
    expect(box.bottom).toBe(0)
    expect(box.left).toBe(0)
    expect(box.right).toBe(0)
  })

  // prosemirror-view's singleRect() (dist/index.cjs:486-493) with its bias
  // branch collapsed to the bias >= 0 case: read the list, and when it yields
  // nothing fall through to the bounding box. Both members are exercised in one
  // call, which is why stubbing only getClientRects would move the throw rather
  // than remove it.
  it('survives a prosemirror-shaped measurement of a text range', () => {
    const singleRect = (target: Range) => {
      const rects = target.getClientRects()
      const nonZero = (r: DOMRect) => r.top < r.bottom || r.left < r.right
      if (rects.length) {
        const first = rects[rects.length - 1]
        if (nonZero(first)) return first
      }
      return Array.prototype.find.call(rects, nonZero) || target.getBoundingClientRect()
    }
    expect(() => singleRect(rangeOverText())).not.toThrow()
    expect(singleRect(rangeOverText()).width).toBe(0)
  })
})
