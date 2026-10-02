import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { noInlinedFonts } from './scripts/no-inlined-fonts'

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
      const out = html.replace("script-src 'self' 'unsafe-inline'", "script-src 'self'")
      // Fail the build loudly if the CSP string in index.html drifted and left
      // script-src allowing 'unsafe-inline' — the exact-match replace above
      // would otherwise no-op silently and ship an unsafe policy.
      const scriptSrc = out.match(/script-src[^;]*/)?.[0] ?? ''
      if (scriptSrc.includes("'unsafe-inline'")) {
        throw new Error(
          `strict-prod-csp: production script-src still allows 'unsafe-inline' — ` +
            `update the CSP rewrite to match index.html. Got: ${scriptSrc}`
        )
      }
      return out
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
    },
    build: {
      rollupOptions: {
        // The MCP server (ADR-0036) is a second main-side entry: it reuses the
        // app's services, so it builds with them and shares their chunks.
        input: {
          index: resolve('src/main/index.ts'),
          mcp: resolve('src/mcp/index.ts')
        }
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
      modulePreload: { polyfill: false },
      // Emit every asset as a file instead of inlining the small ones. Vite's
      // default 4096-byte threshold inlined one @fontsource-variable font
      // subset as a data: URI, which `font-src 'self'` then blocked (#512). The
      // app loads from the local filesystem, so the extra request costs
      // nothing measurable and the CSP stays as strict as it was.
      assetsInlineLimit: 0
    },
    plugins: [react(), tailwindcss(), strictProdCsp, noInlinedFonts]
  }
})
