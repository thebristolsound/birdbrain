// This function is also passed to chrome.scripting.executeScript, so its body
// must stay self-contained and may not close over module state.
export function removeInjectedBirdbrainUi(): void {
  // The capture toast host (#981), matched on toast.ts's TOAST_SELECTOR for
  // the same reason as the selection bar below; kept in step by hand.
  document
    .querySelectorAll('div[data-birdbrain-ui="capture-toast"]')
    .forEach((node) => node.remove())
  // A host an extension version from before the marker left in the tab carries
  // only the id. It is told from a page's own element by its open shadow root
  // holding the toast; a page can forge that pair as it can the marker, the
  // limit toast.ts states.
  document.querySelectorAll('div#birdbrain-capture-toast').forEach((node) => {
    if (node.shadowRoot?.querySelector('.toast')) node.remove()
  })
  // The in-page selection bar host (#393) — kept in step by hand with
  // selectionBar.ts, per the captureSuppression.ts header. Matched on the
  // marker attribute render() sets rather than on the host id: this runs
  // before the MHTML and screenshot frames, so an id match would delete a
  // page-owned element out of the evidence.
  document
    .querySelectorAll('div[data-birdbrain-ui="selection-bar"]')
    .forEach((node) => node.remove())
  document.querySelectorAll('mark.birdbrain-selector-highlight').forEach((mark) => {
    const parent = mark.parentNode
    mark.replaceWith(...Array.from(mark.childNodes))
    parent?.normalize()
  })
  document
    // The birdbrain-styles-* node is the div shadow style host content.ts
    // creates. Constraining to div narrows accidental collisions with
    // page-owned elements; it is not an ownership proof — a page-owned div
    // reusing the extension's id prefix would still be removed
    .querySelectorAll('style[data-birdbrain-highlight="true"], div[id^="birdbrain-styles-"]')
    .forEach((node) => node.remove())
  // The operator's selection highlight (#993), which selectionBar.ts holds and puts back on
  // release. An orphaned script never receives that release, so here it is collapsed, not held:
  // the operator selects again rather than the frames carrying the highlight.
  window.getSelection()?.removeAllRanges()
}
