import { handleExtractionMessage } from '@main/services/extraction/processHandler'

// Entry of the extraction utility process (#598), built as its own main-side
// entry in electron.vite.config.ts and forked by processClient.ts. It answers
// one message per request, in the order they arrive.
process.parentPort.on('message', ({ data }) => {
  process.parentPort.postMessage(handleExtractionMessage(data))
})
