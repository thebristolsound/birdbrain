// One-off: regenerate the Linux icon set in resources/icons/ from resources/icon.png.
// electron-builder installs each <size>x<size>.png into hicolor/<size>x<size>/apps.
// Run with: node scripts/gen-linux-icons.mjs
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'resources', 'icon.png')
const outDir = join(root, 'resources', 'icons')
const sizes = [16, 32, 48, 64, 128, 256, 512]

await mkdir(outDir, { recursive: true })
for (const size of sizes) {
  const out = join(outDir, `${size}x${size}.png`)
  await sharp(src).resize(size, size, { fit: 'contain', kernel: 'lanczos3' }).png().toFile(out)
  console.log(`wrote ${out}`)
}
