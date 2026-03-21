import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, mkdirSync, cpSync } from 'fs'

// Content script must be built as IIFE (Chrome content_scripts don't support ES modules).
// Background + popup can use ES modules (background declares "type": "module" in manifest).
const isContentBuild = process.env.BUILD_TARGET === 'content'

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
      '@extension': resolve(__dirname, 'src')
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
        mkdirSync(resolve(dist, 'icons'), { recursive: true })
        cpSync(resolve(__dirname, 'icons'), resolve(dist, 'icons'), { recursive: true })
        // Move popup.html from nested path to dist root, fix relative paths
        const nestedPopup = resolve(dist, 'extension', 'src', 'popup', 'popup.html')
        try {
          const { readFileSync, writeFileSync, rmSync } = require('fs')
          let html = readFileSync(nestedPopup, 'utf-8')
          html = html.replace(/src="[^"]*popup\.js"/g, 'src="./popup.js"')
          html = html.replace(/href="[^"]*chunks\//g, 'href="./chunks/')
          writeFileSync(resolve(dist, 'popup.html'), html)
          rmSync(resolve(dist, 'extension'), { recursive: true, force: true })
        } catch {}
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
        popup: resolve(__dirname, 'src/popup/popup.html')
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
      '@extension': resolve(__dirname, 'src')
    }
  }
})

export default isContentBuild ? contentConfig : mainConfig
