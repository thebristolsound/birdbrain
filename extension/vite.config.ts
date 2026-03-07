import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, mkdirSync, cpSync } from 'fs'

export default defineConfig({
  plugins: [
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
        content: resolve(__dirname, 'src/content.ts'),
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
