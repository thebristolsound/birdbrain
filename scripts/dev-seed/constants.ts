// What the seeded profile is known by, shared with the unit test and the e2e spec. Kept apart from
// seed.ts, which pulls in the main process, so the e2e spec can import it under plain Node.

export const ORDINARY_CASE_NAME = 'Harbour Lane deposits'
export const SHARED_CASE_NAME = 'Shared: Northgate statements'
export const OWNER_MEMBER_CODE = 'DS'
export const MEMBER_MEMBER_CODE = 'MR'
// The third member the Owner revoked (#1514): on the roster with a `revokedAtIndex`, no chain
// file, nothing merged. The Members tab draws its row dimmed with the revocation date.
export const REVOKED_MEMBER_CODE = 'PN'
export const REVOKED_MEMBER_NAME = 'Priya Natarajan'
// The reason the Owner recorded on the `exclude` of the member's Exhibit MR-1.
export const EXCLUDE_REASON = 'duplicate of DS-1'
export const SELECTOR_PATTERN = 'HL-2291-7734'
