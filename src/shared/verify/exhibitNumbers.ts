// Exhibit Numbers as one chain records them (X18, X45, X46, X48). Pure
// verify-core: the app derives the next number from these assignments and
// reports a repeated one on `exhibits:verify`, and the standalone verifier
// reports the same repeat on a package, so the two cannot disagree about which
// numbers a chain has issued.
//
// Entries are read structurally rather than through `ManifestEntrySchema`, so
// the same rule runs over a verified chain and over a lenient read of one that
// may not verify. The next-number question is "was this number ever issued",
// and a line that fails verification still says it was.

export interface ExhibitNumberAssignment {
  exhibitId: string
  exhibitNumber: number
  // Line position of the entry that carries the assignment.
  index: number
}

export interface RepeatedExhibitNumber {
  exhibitNumber: number
  // Every Exhibit the number is assigned to, in the order the chain first
  // assigned it to each: two or more.
  exhibitIds: string[]
  // The line positions of every entry carrying the number, ascending.
  indices: number[]
}

function isExhibitNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function assignmentsOf(entry: Record<string, unknown>, index: number): ExhibitNumberAssignment[] {
  const { type, exhibitNumber } = entry
  if (type === 'capture' || type === 'exhibit') {
    const exhibitId = type === 'capture' ? entry.captureId : entry.exhibitId
    return typeof exhibitId === 'string' && isExhibitNumber(exhibitNumber)
      ? [{ exhibitId, exhibitNumber, index }]
      : []
  }
  if (type !== 'renumber' || !Array.isArray(entry.assignments)) return []
  return entry.assignments.flatMap((assignment: unknown) => {
    if (assignment === null || typeof assignment !== 'object') return []
    const { exhibitId, exhibitNumber: number } = assignment as Record<string, unknown>
    return typeof exhibitId === 'string' && isExhibitNumber(number)
      ? [{ exhibitId, exhibitNumber: number, index }]
      : []
  })
}

/**
 * Every Exhibit Number a chain assigns, in chain order, split into the
 * sequences it numbers independently. A `capture` entry carries its own number
 * (X46), an `exhibit` entry its own, and a `renumber` entry one per assignment.
 *
 * A sequence ends at a fork: an `import` whose preceding segment carries a
 * `member-add`, so the Case it continues was shared. The fork's import stamps
 * every row from before it with its member author (the Case Archive's
 * `attributeForkedExhibits`), so those numbers are its members' and the fork
 * numbers its own Exhibits from 1. An import of a Case nobody shared
 * keeps its rows as the importer's own, and the sequence runs on across it.
 */
export function exhibitNumberSequences(
  entries: readonly Record<string, unknown>[]
): ExhibitNumberAssignment[][] {
  const sequences: ExhibitNumberAssignment[][] = [[]]
  let segmentShared = false
  entries.forEach((entry, index) => {
    if (entry.type === 'member-add') segmentShared = true
    if (entry.type === 'import') {
      if (segmentShared) sequences.push([])
      segmentShared = false
    }
    sequences[sequences.length - 1].push(...assignmentsOf(entry, index))
  })
  return sequences
}

/**
 * The highest Exhibit Number this chain's writer has issued in its current
 * sequence, deleted Exhibits included: a `deletion` appends and removes no
 * assignment (X45). 0 when it has issued none.
 */
export function highestIssuedExhibitNumber(entries: readonly Record<string, unknown>[]): number {
  const current = exhibitNumberSequences(entries).at(-1) ?? []
  return current.reduce((highest, { exhibitNumber }) => Math.max(highest, exhibitNumber), 0)
}

/**
 * Every number one sequence assigns to more than one Exhibit (X48). A reissued
 * number is an Integrity Exception, never tamper: the entries carrying it can
 * all verify, and what fails is a citation of the number, which names more
 * than one Exhibit.
 *
 * The same Exhibit carrying one number on two entries is not a repeat. A
 * `renumber` written by a build before X46 lists every Exhibit of the Case,
 * including ones whose `exhibit` entry already carries the number.
 */
export function findRepeatedExhibitNumbers(
  entries: readonly Record<string, unknown>[]
): RepeatedExhibitNumber[] {
  const repeats: RepeatedExhibitNumber[] = []
  for (const sequence of exhibitNumberSequences(entries)) {
    const byNumber = new Map<number, ExhibitNumberAssignment[]>()
    for (const assignment of sequence) {
      byNumber.set(assignment.exhibitNumber, [
        ...(byNumber.get(assignment.exhibitNumber) ?? []),
        assignment
      ])
    }
    for (const [exhibitNumber, assigned] of byNumber) {
      const exhibitIds = [...new Set(assigned.map((a) => a.exhibitId))]
      if (exhibitIds.length < 2) continue
      const indices = [...new Set(assigned.map((a) => a.index))].sort((a, b) => a - b)
      repeats.push({ exhibitNumber, exhibitIds, indices })
    }
  }
  return repeats.sort((a, b) => a.indices[0] - b.indices[0] || a.exhibitNumber - b.exhibitNumber)
}

/**
 * The sentence every verifier prints for a repeated number, so the app and the
 * standalone verifier word the exception the same way.
 */
export function describeRepeatedExhibitNumber(repeat: RepeatedExhibitNumber): string {
  const { exhibitNumber, exhibitIds, indices } = repeat
  return (
    `Integrity Exception: Exhibit Number ${exhibitNumber} is assigned to ` +
    `${exhibitIds.length} exhibits (${exhibitIds.join(', ')}) by the entries at index ` +
    `${indices.join(', ')}, so a citation of that number does not name one exhibit. ` +
    'This is not a tamper verdict.'
  )
}
