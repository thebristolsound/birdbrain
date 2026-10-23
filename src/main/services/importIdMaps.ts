import { createHash } from 'crypto'
import { IMPORT_ID_MAPS_DIRECTORY } from '@shared/constants'
import { canonicalStringify } from '@shared/verify'

// The rules for the id maps an archive import writes (#1017): which bytes
// count as the map a signed `import` entry records, and how the maps of every
// import in a chain resolve an entry's id to the row that now holds it. The
// archive's check and the app's binding both apply them, so an archive never
// carries a map the binding would read differently. No filesystem, no DB.

// The `import` entry fields a map is checked against.
export interface IdMapEntry {
  caseId: string
  sourceCaseId: string
  idMapSha256: string
}

const sha256 = (text: string): string =>
  createHash('sha256').update(Buffer.from(text, 'utf-8')).digest('hex')

// A digest a path may be built from: anything else could name another file.
export function isIdMapDigest(hex: string): boolean {
  return /^[0-9a-f]{64}$/.test(hex)
}

// Where a map with this digest sits, relative to a Case directory or an
// archive's root. Only ever called with a digest `isIdMapDigest` accepted.
export function carriedIdMapName(hex: string): string {
  return `${IMPORT_ID_MAPS_DIRECTORY}/${hex}.json`
}

// The renames a map holds, or undefined when it is not the map `entry` signs.
// A carried map must be the exact canonical bytes the digest covers, so its
// text has one reading. The importer's own map (`canonical: false`) is pretty
// JSON hashed by its canonical form, the recipe its import entry used. Either
// way the payload is exactly the entry's ids and a map of strings that renames
// no two ids onto one, no id onto itself and no id onto one of its keys.
export function parseIdMap(
  text: string,
  entry: IdMapEntry,
  { canonical }: { canonical: boolean }
): Map<string, string> | undefined {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return undefined
  }
  const encoded = canonicalStringify(payload)
  if (canonical && encoded !== text) return undefined
  if (sha256(encoded) !== entry.idMapSha256) return undefined
  if (!isPlainObject(payload)) return undefined
  const keys = Object.keys(payload).sort()
  if (keys.join(',') !== 'caseId,remapped,sourceCaseId') return undefined
  const { caseId, sourceCaseId, remapped } = payload
  if (caseId !== entry.caseId || sourceCaseId !== entry.sourceCaseId) return undefined
  if (!isPlainObject(remapped)) return undefined
  const map = new Map<string, string>()
  for (const [from, to] of Object.entries(remapped)) {
    if (typeof to !== 'string' || to === from) return undefined
    map.set(from, to)
  }
  const values = new Set(map.values())
  if (values.size !== map.size) return undefined
  for (const value of values) if (map.has(value)) return undefined
  return map
}

// Whether any map renames a row onto an id a `capture` or `exhibit` entry
// signs, which would bind that signed identity's entries to another row.
export function renamesOntoSignedId(
  maps: ReadonlyArray<ReadonlyMap<string, string>>,
  entries: ReadonlyArray<Record<string, unknown>>
): boolean {
  const signed = new Set<unknown>(
    entries.map((entry) =>
      entry.type === 'capture'
        ? entry.captureId
        : entry.type === 'exhibit'
          ? entry.exhibitId
          : undefined
    )
  )
  return maps.some((map) => [...map.values()].some((value) => signed.has(value)))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// The maps of a chain's imports, oldest first, applied in that order: an id is
// renamed by each map that holds it as a key. Undefined when two positions
// rename onto one id, which would bind two signed ids to one row. `trail`
// lists every id the fold passes through, the id itself first and where it
// ends last. `record` maps every key of every map to where the fold takes it,
// as own properties only, so no id resolves through the prototype.
export function composeIdMaps(maps: ReadonlyArray<ReadonlyMap<string, string>>):
  | {
      resolve: (id: string) => string
      trail: (id: string) => string[]
      record: Record<string, string>
    }
  | undefined {
  const seen = new Set<string>()
  for (const map of maps) {
    for (const value of map.values()) {
      if (seen.has(value)) return undefined
      seen.add(value)
    }
  }
  const trail = (id: string): string[] =>
    maps.reduce(
      (ids, map) => {
        const next = map.get(ids[ids.length - 1])
        return next === undefined ? ids : [...ids, next]
      },
      [id]
    )
  const resolve = (id: string): string => trail(id).at(-1)!
  const record = Object.fromEntries(
    maps.flatMap((map) => [...map.keys()]).map((key) => [key, resolve(key)])
  )
  return { resolve, trail, record }
}
