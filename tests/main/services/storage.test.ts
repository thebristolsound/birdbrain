import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  ensureCaseDir,
  getCaseStorageSize,
  initStorage,
  readStorageRootMark,
  renewStorageRootMark,
  storageRootMarkOfThisLaunch
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

  describe('the storage root mark', () => {
    let root: string
    const marker = (): string => join(root, '.birdbrain-storage-root.json')

    beforeEach(() => {
      root = join(tempDir, 'captures')
      initStorage(root)
    })

    it('reads no mark from a root that holds none', () => {
      expect(readStorageRootMark()).toBeNull()
      expect(storageRootMarkOfThisLaunch()).toBeNull()
    })

    it('writes a mark of sixteen hex digits that the root then holds', () => {
      renewStorageRootMark()

      const mark = readStorageRootMark()
      expect(mark).toMatch(/^[0-9a-f]{16}$/)
      expect(JSON.parse(readFileSync(marker(), 'utf-8'))).toEqual({ mark })
      expect(storageRootMarkOfThisLaunch()).toBe(mark)
    })

    it('writes a different mark each time', () => {
      renewStorageRootMark()
      const first = readStorageRootMark()
      renewStorageRootMark()

      expect(readStorageRootMark()).not.toBe(first)
      expect(storageRootMarkOfThisLaunch()).toBe(readStorageRootMark())
    })

    // The next launch reads what the last one wrote, and has written nothing yet.
    it('gives a launch no mark of its own until it writes one', () => {
      renewStorageRootMark()
      const written = readStorageRootMark()
      initStorage(root)

      expect(readStorageRootMark()).toBe(written)
      expect(storageRootMarkOfThisLaunch()).toBeNull()
    })

    it('gives no mark once the root no longer holds the one this launch wrote', () => {
      renewStorageRootMark()
      renameSync(root, `${root}-unmounted`)
      mkdirSync(root)
      expect(storageRootMarkOfThisLaunch()).toBeNull()

      writeFileSync(marker(), JSON.stringify({ mark: '0123456789abcdef' }))
      expect(readStorageRootMark()).toBe('0123456789abcdef')
      expect(storageRootMarkOfThisLaunch()).toBeNull()
    })

    it.each([
      ['is not JSON', 'not json'],
      ['is not an object', 'null'],
      ['holds no mark', '{}'],
      ['holds a mark that is not a string', '{"mark":7}'],
      ['holds a mark of another shape', '{"mark":"0123456789ABCDEF"}']
    ])('reads no mark when the file %s', (_label, contents) => {
      writeFileSync(marker(), contents)

      expect(readStorageRootMark()).toBeNull()
    })

    it.skipIf(process.getuid?.() === 0)(
      'leaves the launch with no mark when the file cannot be written',
      () => {
        renewStorageRootMark()
        const held = readStorageRootMark()
        chmodSync(marker(), 0o400)

        renewStorageRootMark()

        expect(readStorageRootMark()).toBe(held)
        expect(storageRootMarkOfThisLaunch()).toBeNull()
      }
    )

    // A directory where the file should be: the write fails for any user.
    it('leaves the launch with no mark when the marker path is a directory', () => {
      mkdirSync(marker())

      renewStorageRootMark()

      expect(readStorageRootMark()).toBeNull()
      expect(storageRootMarkOfThisLaunch()).toBeNull()
      expect(existsSync(marker())).toBe(true)
    })
  })
})
