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
    // creates; constrain by element type so a page-owned element that happens
    // to share the id prefix is not removed from an uncontrolled page
    .querySelectorAll('style[data-birdbrain-highlight="true"], div[id^="birdbrain-styles-"]')
    .forEach((node) => node.remove())
}
