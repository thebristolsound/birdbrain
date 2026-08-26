// jsdom has no layout engine, and it is inconsistent about which half of the
// measurement API it stubs. Element gets getClientRects() and
// getBoundingClientRect() returning zeroes; Range gets neither, so measuring a
// text range throws TypeError rather than reading a zero box.
//
// ProseMirror measures text ranges. singleRect() calls target.getClientRects()
// on a Range built by its own textRange() helper, reached through TipTap's
// scrollIntoView, so any editor test that scrolls can throw
// `target.getClientRects is not a function`. It surfaces as an unhandled error
// rather than a failed assertion, which is why the suite exits non-zero with
// nothing reported red (#1013; same class as #834/#837 and the ad-hoc
// Range.prototype patches in tests/extension/).
//
// Both members are needed together: singleRect() falls back to
// getBoundingClientRect() when getClientRects() returns nothing, so stubbing
// only the first moves the throw one line down.
//
// Zeroes are the honest answer. jsdom returns zeroes for elements, and a test
// that needs real geometry stubs it locally the way OnboardingTour.test.tsx and
// useNoteSelection.test.ts already do. Both stubs are installed only if absent,
// so a local stub set before this file runs is left alone.

const zeroRect = (): DOMRect => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({})
})

const emptyRectList = (): DOMRectList =>
  Object.assign([] as DOMRect[], { item: () => null }) as unknown as DOMRectList

if (typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = emptyRectList
}

if (typeof Range.prototype.getBoundingClientRect !== 'function') {
  Range.prototype.getBoundingClientRect = zeroRect
}
