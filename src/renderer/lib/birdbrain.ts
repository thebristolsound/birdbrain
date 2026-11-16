import type { BirdbrainAPI } from '@shared/birdbrainApi'
import { adaptBridge } from '@shared/bridgeAdapter'

// The renderer's way to the invoke methods of the preload bridge. A refused
// call rejects there with a plain object; calling through `birdbrain` turns it
// back into an Error that keeps main's code. ESLint fails a direct reference to
// `window.birdbrain` elsewhere in the renderer, with two exceptions: a
// subscription, which returns no promise, and the four error-reporting modules
// (queryClient.ts, mainLogBridge.ts, notify.ts, globalErrorLog.ts), which
// discard a rejection.
export const birdbrain: BirdbrainAPI = adaptBridge(() => window.birdbrain)
