// jsdom 30.1.0 fires a `blur` at `window` when focus moves within the
// document after the focused element was removed (jsdom/jsdom#4347; 30.0.1 is
// not affected). Removal parks focus on the Document, and the next focus()
// treats the Document as the element losing focus, which retargets its blur to
// the window.
//
// Radix Menu closes on window blur, since that is how a page learns the user
// switched away. A context menu that moves focus on open therefore closes
// itself as soon as it opens, and every right-click menu test sees no menu.
//
// A real window blur has no relatedTarget: nothing in the document is gaining
// focus. The spurious one carries the element being focused, so that is the
// event dropped here. The capture listener on the target runs before any
// component's listener because this file runs before any test module.
//
// The phase check stands in for `event.target === window`: under Vitest the
// `window` global is not the jsdom Window that dispatches the event, so the
// identity comparison never matches. A listener on the window sees AT_TARGET
// only for events aimed at the window itself.
//
// Remove this file once the pinned jsdom carries the upstream fix.

window.addEventListener(
  'blur',
  (event) => {
    if (event.eventPhase === Event.AT_TARGET && event.relatedTarget !== null) {
      event.stopImmediatePropagation()
    }
  },
  { capture: true }
)
