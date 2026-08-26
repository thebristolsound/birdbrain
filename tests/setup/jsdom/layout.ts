// jsdom has no layout engine, and it is inconsistent about which half of the
// measurement API it stubs. Element gets both members — getClientRects()
// returns an empty list, getBoundingClientRect() a zeroed rect — while Range
// gets neither, so measuring a text range throws TypeError rather than reading
// a zero box.
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
// An empty list and a zero box are the honest answers: they are what jsdom
// already gives an element. Both assignments are unconditional, because vitest
// evaluates setup files before any test module body — the members are always
// absent when this runs, and a test that needs real geometry just assigns over
// them afterwards. An `only if absent` guard here would be dead code, and worse
// would model a pattern that silently no-ops when copied into a test file.
//
// Nothing in the suite conflicts today: the local geometry stubs in
// OnboardingTour.test.tsx and useNoteSelection.test.ts patch Element instances
// and a fake Selection object, never Range.prototype.

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

Range.prototype.getClientRects = emptyRectList
Range.prototype.getBoundingClientRect = zeroRect
