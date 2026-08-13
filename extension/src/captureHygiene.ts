// This function is also passed to chrome.scripting.executeScript, so its body
// must stay self-contained and may not close over module state.
export function removeInjectedBirdbrainUi(): void {
  document.getElementById('birdbrain-capture-toast')?.remove()
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
}
