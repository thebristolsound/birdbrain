import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Removes script-src 'unsafe-inline' from the renderer CSP in production builds
// only. Dev keeps it because @vitejs/plugin-react injects an inline refresh
// preamble and Vite's HMR client needs inline execution; the production bundle
// has no inline scripts (theme bootstrap is externalized to public/theme-init.js
// and modulePreload.polyfill is off), so 'self' alone is sufficient there.
const strictProdCsp = {
  name: 'strict-prod-csp',
  transformIndexHtml: {
    order: 'post' as const,
    handler(html: string, ctx: { server?: unknown }): string {
      if (ctx.server) return html
      return html.replace("script-src 'self' 'unsafe-inline'", "script-src 'self'")
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      // Electron's Chromium supports modulepreload natively, so skip Vite's
      // inline polyfill script — that keeps the production HTML free of inline
      // scripts so the strict CSP above holds even if code-splitting is added.
      modulePreload: { polyfill: false }
    },
    plugins: [react(), tailwindcss(), strictProdCsp]
  }
})
