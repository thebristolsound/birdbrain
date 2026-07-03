import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

// Dev-server only: @vitejs/plugin-react injects an inline react-refresh
// preamble that the production script-src (self + hash) would block. Relax
// script-src for `dev`; builds keep the strict CSP from index.html.
function relaxCspForDev(): Plugin {
  return {
    name: 'birdbrain:relax-csp-for-dev',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(/script-src [^;]*/, "script-src 'self' 'unsafe-inline'")
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
    plugins: [react(), tailwindcss(), relaxCspForDev()]
  }
})
