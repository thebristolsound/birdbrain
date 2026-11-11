import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  confirmStorageRoot,
  ensureCaseDir,
  getCaseStorageSize,
  initStorage,
  STORAGE_ROOT_RECORD
} from '@main/services/storage'

describe('storage', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-test-'))
    initStorage(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('ensureCaseDir creates the case directory', () => {
    const dir = ensureCaseDir('new-case')
    expect(dir).toBe(join(tempDir, 'new-case'))
    expect(existsSync(dir)).toBe(true)
  })

  it('calculates case storage size', () => {
    const dir = join(tempDir, 'case-1')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'cap-1.html'), 'a'.repeat(100))
    writeFileSync(join(dir, 'cap-2.html'), 'b'.repeat(200))

    const size = getCaseStorageSize('case-1')
    expect(size).toBe(300)
  })

  it('returns 0 for non-existent case directory', () => {
    expect(getCaseStorageSize('nonexistent')).toBe(0)
  })

  describe('confirmStorageRoot', () => {
    let root: string
    let recordPath: string
    const marker = (): string => join(root, '.birdbrain-storage-root.json')
    const nonceIn = (path: string): unknown => JSON.parse(readFileSync(path, 'utf-8')).nonce

    beforeEach(() => {
      root = join(tempDir, 'captures')
      recordPath = join(tempDir, STORAGE_ROOT_RECORD)
      initStorage(root)
    })

    it('starts a run on a root with no marker and writes the same value to both files', () => {
      const before = Date.now()
      const { since, continued } = confirmStorageRoot(recordPath)

      expect(continued).toBe(false)
      expect(Date.parse(since ?? '')).toBeGreaterThanOrEqual(before)
      expect(typeof nonceIn(marker())).toBe('string')
      expect(nonceIn(recordPath)).toBe(nonceIn(marker()))
    })

    it('continues the run on the next launch, keeps its start and writes a new value', () => {
      const first = confirmStorageRoot(recordPath)
      const firstNonce = nonceIn(marker())
      const second = confirmStorageRoot(recordPath)

      expect(second).toEqual({ since: first.since, continued: true })
      expect(nonceIn(marker())).not.toBe(firstNonce)
      expect(nonceIn(recordPath)).toBe(nonceIn(marker()))
    })

    it('starts a new run on a root that holds no marker', () => {
      confirmStorageRoot(recordPath)
      rmSync(marker())

      expect(confirmStorageRoot(recordPath).continued).toBe(false)
    })

    it('starts a new run on another root', () => {
      confirmStorageRoot(recordPath)
      initStorage(join(tempDir, 'elsewhere'))

      expect(confirmStorageRoot(recordPath).continued).toBe(false)
    })

    it('starts a new run on a copy of the root from before the last marker was written', () => {
      confirmStorageRoot(recordPath)
      const copy = join(tempDir, 'copy')
      cpSync(root, copy, { recursive: true })
      confirmStorageRoot(recordPath)
      rmSync(root, { recursive: true })
      cpSync(copy, root, { recursive: true })

      expect(confirmStorageRoot(recordPath).continued).toBe(false)
    })

    // The limit the function documents: such a copy carries the last marker.
    it('continues the run on a copy of the root taken after the last marker was written', () => {
      const first = confirmStorageRoot(recordPath)
      const copy = join(tempDir, 'copy')
      cpSync(root, copy, { recursive: true })
      rmSync(root, { recursive: true })
      cpSync(copy, root, { recursive: true })

      expect(confirmStorageRoot(recordPath)).toEqual({ since: first.since, continued: true })
    })

    it.each([
      ['is missing', (): void => rmSync(recordPath)],
      ['is not JSON', (): void => writeFileSync(recordPath, 'not json')],
      ['is not an object', (): void => writeFileSync(recordPath, 'null')],
      [
        'has no start time',
        (): void => writeFileSync(recordPath, JSON.stringify({ nonce: nonceIn(marker()) }))
      ],
      ['has no value', (): void => writeFileSync(recordPath, JSON.stringify({ since: 'x' }))]
    ])('starts a new run when the record %s', (_label, damage) => {
      confirmStorageRoot(recordPath)
      damage()

      expect(confirmStorageRoot(recordPath).continued).toBe(false)
    })

    it('reports no start when the record cannot be written', () => {
      expect(confirmStorageRoot(join(tempDir, 'no-such-folder', STORAGE_ROOT_RECORD))).toEqual({
        since: null,
        continued: false
      })
      expect(existsSync(marker())).toBe(false)
    })

    it.skipIf(process.getuid?.() === 0)(
      'reports no start when the marker cannot be written, and starts a new run next time',
      () => {
        confirmStorageRoot(recordPath)
        chmodSync(marker(), 0o400)
        expect(confirmStorageRoot(recordPath)).toEqual({ since: null, continued: true })

        chmodSync(marker(), 0o600)
        expect(confirmStorageRoot(recordPath).continued).toBe(false)
      }
    )
  })
})
