import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'fs'

// Content script must be built as IIFE (Chrome content_scripts don't support ES modules).
// Background + popup can use ES modules (background declares "type": "module" in manifest).
const isContentBuild = process.env.BUILD_TARGET === 'content'

// Every HTML entry point, by directory name under src/. Each one is both a
// Rollup input and a page the closeBundle fixup below lifts to the dist root.
const HTML_ENTRIES = ['popup', 'options'] as const

const contentConfig = defineConfig({
  esbuild: {
    charset: 'ascii'
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: false,
    modulePreload: false,
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content.ts')
      },
      output: {
        format: 'iife',
        entryFileNames: '[name].js'
      }
    }
  },
  resolve: {
    alias: {
      '@extension': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, '../src/shared')
    }
  }
})

const mainConfig = defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    {
      name: 'copy-extension-assets',
      closeBundle() {
        const dist = resolve(__dirname, 'dist')
        copyFileSync(resolve(__dirname, 'manifest.json'), resolve(dist, 'manifest.json'))
        copyFileSync(resolve(__dirname, 'theme-preinit.js'), resolve(dist, 'theme-preinit.js'))
        copyFileSync(
          resolve(__dirname, 'THIRD_PARTY_NOTICES.txt'),
          resolve(dist, 'THIRD_PARTY_NOTICES.txt')
        )
        mkdirSync(resolve(dist, 'icons'), { recursive: true })
        cpSync(resolve(__dirname, 'icons'), resolve(dist, 'icons'), { recursive: true })
        mkdirSync(resolve(dist, 'fonts'), { recursive: true })
        cpSync(resolve(__dirname, 'src/fonts'), resolve(dist, 'fonts'), { recursive: true })
        // Move each HTML entry from its nested path to the dist root and fix the
        // asset paths, which Rollup emits relative to that nested location.
        // The rmSync of the nested tree runs once, after every page is written:
        // doing it per page would delete the next page's source HTML, and the
        // catch inside the loop would swallow that into a green build.
        for (const name of HTML_ENTRIES) {
          const nested = resolve(dist, 'extension', 'src', name, `${name}.html`)
          try {
            let html = readFileSync(nested, 'utf-8')
            html = html.replace(new RegExp(`src="[^"]*${name}\\.js"`, 'g'), `src="./${name}.js"`)
            html = html.replace(/href="[^"]*chunks\//g, 'href="./chunks/')
            html = html.replace(/href="[^"]*assets\//g, 'href="./assets/')
            html = html.replace(
              '</head>',
              '    <script src="./theme-preinit.js"></script>\n  </head>'
            )
            writeFileSync(resolve(dist, `${name}.html`), html)
          } catch {
            /* the HTML entries do not exist in content-only builds */
          }
        }
        rmSync(resolve(dist, 'extension'), { recursive: true, force: true })
      }
    }
  ],
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        ...Object.fromEntries(
          HTML_ENTRIES.map((name) => [name, resolve(__dirname, `src/${name}/${name}.html`)])
        )
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  },
  resolve: {
    alias: {
      '@extension': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, '../src/shared')
    }
  }
})

export default isContentBuild ? contentConfig : mainConfig
