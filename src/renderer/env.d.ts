/// <reference types="vite/client" />
/// <reference types="electron" />

import type { BirdbrainAPI } from '@shared/birdbrainApi'

declare global {
  interface Window {
    birdbrain: BirdbrainAPI
  }

  // Extend JSX intrinsics in the global namespace so webview attributes are
  // recognized. Without declare global, this augmentation would be scoped to
  // this module (because of the top-level import) and TypeScript would fall
  // back to React's default typings where these attributes are booleans.
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          nodeintegration?: string
          allowpopups?: string
          webpreferences?: string
          partition?: string
        },
        HTMLElement
      >
    }
  }
}
