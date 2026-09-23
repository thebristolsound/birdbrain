// How an Exhibit Number is written out (decision 7,
// docs/specs/2026-09-19-collaborative-cases-design.md). In a Shared Case the
// sequence is per member and the citation carries the Member Code:
// `NK-12`, `MB-12`. The prefix is hidden in the app while the Case has one
// member and always shown in an export, so the caller says whether to prefix
// and this only knows how. A row with no code cites bare, whatever the caller
// asked: a prefix nobody recorded would be a claim nobody made.
//
// Pure and shared: the main process resolves the code and the rule, the
// renderer, the report and the Manifest Ledger only print what they were given.

export interface ExhibitCitationSource {
  exhibitNumber: number
  memberCode?: string | null
}

export function formatExhibitCitation(
  source: ExhibitCitationSource,
  options: { prefixed: boolean }
): string {
  const { exhibitNumber, memberCode } = source
  return options.prefixed && memberCode ? `${memberCode}-${exhibitNumber}` : `${exhibitNumber}`
}
