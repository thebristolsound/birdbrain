import type { BirdbrainAPI } from '@shared/birdbrainApi'
import { adaptBridge } from '@shared/bridgeAdapter'

// The renderer's way to every invoke method of the preload bridge. A refused
// call rejects there with a plain object; calling through `birdbrain` turns it
// back into an Error that keeps main's code, so no call site sees the plain
// object. ESLint fails a direct reference to `window.birdbrain` anywhere else
// in the renderer except a subscription, which returns no promise.
export const birdbrain: BirdbrainAPI = adaptBridge(() => window.birdbrain)
