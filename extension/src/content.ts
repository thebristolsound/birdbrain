// Content script — runs on every page at document_idle
// Extracts page data when asked by the background script

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EXTRACT_PAGE') {
    sendResponse({
      html: document.documentElement.outerHTML,
      title: document.title,
      textContent: document.body?.innerText || ''
    })
  }
  return true // Keep channel open for async response
})
