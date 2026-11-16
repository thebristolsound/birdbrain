import type { BirdbrainAPI } from '@shared/birdbrainApi'
import { adaptBridge } from '@shared/bridgeAdapter'

// The renderer's one way to the preload bridge. A refused call rejects there
// with a plain object; calling through `birdbrain` turns it back into an Error
// that keeps main's code, so no call site sees the plain object. ESLint keeps
// `window.birdbrain` out of the rest of the renderer.
export const birdbrain: BirdbrainAPI = adaptBridge(() => window.birdbrain)
